import {
  Opcode,
  ProposeMiddlewareContext,
  ProtocolMessageData,
  ProtocolNames,
  ProtocolParams,
  ProtocolRoles,
} from "@connext/types";
import { getSignerAddressFromPublicIdentifier, logTime, stringify } from "@connext/utils";

import { UNASSIGNED_SEQ_NO } from "../constants";
import { getSetStateCommitment, getConditionalTransactionCommitment } from "../ethereum";
import { AppInstance } from "../models";
import { Context, PersistAppType, ProtocolExecutionFlow } from "../types";

import { assertIsValidSignature, computeInterpreterParameters } from "./utils";

const protocol = ProtocolNames.propose;
const { OP_SIGN, OP_VALIDATE, IO_SEND, IO_SEND_AND_WAIT, PERSIST_APP_INSTANCE } = Opcode;

/**
 * @description This exchange is described at the following URL:
 *
 */
export const PROPOSE_PROTOCOL: ProtocolExecutionFlow = {
  0 /* Initiating */: async function* (context: Context) {
    const { message, preProtocolStateChannel } = context;
    const log = context.log.newContext("CF-ProposeProtocol");
    const start = Date.now();
    let substart = start;
    const { processID, params } = message;
    log.info(`[${processID}] Initiation started`);
    log.debug(`[${processID}] Initiation started: ${stringify(params)}`);

    const {
      abiEncodings,
      appDefinition,
      defaultTimeout,
      initialState,
      initiatorDeposit,
      initiatorDepositAssetId,
      initiatorIdentifier,
      meta,
      outcomeType,
      responderDeposit,
      responderDepositAssetId,
      responderIdentifier,
      stateTimeout,
    } = params as ProtocolParams.Propose;

    if (!params) throw new Error("No params found for proposal");
    if (!preProtocolStateChannel) throw new Error("No state channel found for proposal");

    const interpreterParams = computeInterpreterParameters(
      preProtocolStateChannel.multisigOwners,
      outcomeType,
      initiatorDepositAssetId,
      responderDepositAssetId,
      initiatorDeposit,
      responderDeposit,
      getSignerAddressFromPublicIdentifier(initiatorIdentifier),
      getSignerAddressFromPublicIdentifier(responderIdentifier),
      true,
    );

    const proposal = new AppInstance(
      /* multisigAddres */ preProtocolStateChannel!.multisigAddress,
      /* initiator */ initiatorIdentifier,
      /* initiatorDeposit */ initiatorDeposit.toHexString(),
      /* initiatorDepositAssetId */ initiatorDepositAssetId,
      /* responder */ responderIdentifier,
      /* responderDeposit */ responderDeposit.toHexString(),
      /* responderDepositAssetId */ responderDepositAssetId,
      /* abiEncodings */ abiEncodings,
      /* appDefinition */ appDefinition,
      /* appSeqNo */ preProtocolStateChannel!.numProposedApps + 1,
      /* latestState */ initialState,
      /* latestVersionNumber */ 1,
      /* defaultTimeout */ defaultTimeout.toHexString(),
      /* stateTimeout */ stateTimeout.toHexString(),
      /* outcomeType */ outcomeType,
      /* interpreterParamsInternal*/ interpreterParams,
      /* meta */ meta,
    );
    const proposalJson = proposal.toJson();

    const error = yield [
      OP_VALIDATE,
      protocol,
      {
        proposal: proposalJson,
        params,
        role: ProtocolRoles.initiator,
        stateChannel: preProtocolStateChannel!.toJson(),
      } as ProposeMiddlewareContext,
    ];
    if (!!error) {
      throw new Error(error);
    }
    logTime(log, substart, `[${processID}] Validated proposal`);
    substart = Date.now();

    // 0 ms
    const postProtocolStateChannel = preProtocolStateChannel!.addProposal(proposalJson);

    const setStateCommitment = getSetStateCommitment(context, proposal as AppInstance);

    const conditionalTxCommitment = getConditionalTransactionCommitment(
      context,
      postProtocolStateChannel,
      proposal as AppInstance,
    );

    substart = Date.now();

    const setStateCommitmentHash = setStateCommitment.hashToSign();
    const initiatorSignatureOnInitialState = yield [OP_SIGN, setStateCommitmentHash];

    const conditionalTxCommitmentHash = conditionalTxCommitment.hashToSign();
    const initiatorSignatureOnConditionalTransaction = yield [OP_SIGN, conditionalTxCommitmentHash];
    logTime(
      log,
      substart,
      `[${processID}] Signed set state commitment ${setStateCommitmentHash} & conditional transfer commitment ${conditionalTxCommitmentHash}`,
    );

    const m1 = {
      protocol,
      processID,
      params,
      seq: 1,
      to: responderIdentifier,
      customData: {
        signature: initiatorSignatureOnInitialState,
        signature2: initiatorSignatureOnConditionalTransaction,
      },
    } as ProtocolMessageData;

    substart = Date.now();

    // 200ms
    const m2 = yield [IO_SEND_AND_WAIT, m1];
    logTime(log, substart, `[${processID}] Received responder's m2`);
    substart = Date.now();

    const {
      data: {
        customData: {
          signature: responderSignatureOnInitialState,
          signature2: responderSignatureOnConditionalTransaction,
        },
      },
    } = m2!;

    substart = Date.now();
    await assertIsValidSignature(
      getSignerAddressFromPublicIdentifier(responderIdentifier),
      setStateCommitmentHash,
      responderSignatureOnInitialState,
      `Failed to validate responders signature on initial set state commitment in the propose protocol. Our commitment: ${stringify(
        setStateCommitment.toJson(),
      )}. Initial state: ${stringify(initialState)}`,
    );
    logTime(
      log,
      substart,
      `[${processID}] Asserted valid responder signature set state commitment`,
    );

    substart = Date.now();
    await assertIsValidSignature(
      getSignerAddressFromPublicIdentifier(responderIdentifier),
      conditionalTxCommitmentHash,
      responderSignatureOnConditionalTransaction,
      `Failed to validate responders signature on conditional transaction commitment in the propose protocol. Our commitment: ${stringify(
        conditionalTxCommitment.toJson(),
      )}. Initial state: ${stringify(initialState)}`,
    );
    logTime(
      log,
      substart,
      `[${processID}] Asserted valid responder signature on conditional transaction`,
    );

    // add signatures to commitment and save
    await setStateCommitment.addSignatures(
      initiatorSignatureOnInitialState as any,
      responderSignatureOnInitialState,
    );
    await conditionalTxCommitment.addSignatures(
      initiatorSignatureOnConditionalTransaction as any,
      responderSignatureOnConditionalTransaction,
    );

    substart = Date.now();

    // 78 ms(!)
    yield [
      PERSIST_APP_INSTANCE,
      PersistAppType.CreateProposal,
      postProtocolStateChannel,
      proposalJson,
      setStateCommitment,
      conditionalTxCommitment,
    ];
    logTime(log, substart, `[${processID}] Persisted app instance ${proposalJson.identityHash}`);
    substart = Date.now();

    // Total 298ms
    logTime(log, start, `[${processID}] Initiation finished`);
  },

  1 /* Responding */: async function* (context: Context) {
    const { message, preProtocolStateChannel } = context;
    const { params, processID } = message;
    const log = context.log.newContext("CF-ProposeProtocol");
    const start = Date.now();
    let substart = start;
    log.info(`[${processID}] Response started`);
    log.debug(`[${processID}] Protocol response started with parameters ${stringify(params)}`);

    const {
      abiEncodings,
      appDefinition,
      defaultTimeout,
      initialState,
      initiatorDeposit,
      initiatorDepositAssetId,
      initiatorIdentifier,
      meta,
      outcomeType,
      responderDeposit,
      responderDepositAssetId,
      responderIdentifier,
      stateTimeout,
    } = params as ProtocolParams.Propose;

    const {
      customData: {
        signature: initiatorSignatureOnInitialState,
        signature2: initiatorSignatureOnConditionalTransaction,
      },
    } = message;

    if (!params) {
      throw new Error("No params found for proposal");
    }
    if (!preProtocolStateChannel) {
      throw new Error("No state channel found for proposal");
    }

    const interpreterParams = computeInterpreterParameters(
      preProtocolStateChannel.multisigOwners,
      outcomeType,
      initiatorDepositAssetId,
      responderDepositAssetId,
      initiatorDeposit,
      responderDeposit,
      getSignerAddressFromPublicIdentifier(initiatorIdentifier),
      getSignerAddressFromPublicIdentifier(responderIdentifier),
      true,
    );

    const proposal = new AppInstance(
      /* multisigAddres */ preProtocolStateChannel!.multisigAddress,
      /* initiator */ initiatorIdentifier,
      /* initiatorDeposit */ initiatorDeposit.toHexString(),
      /* initiatorDepositAssetId */ initiatorDepositAssetId,
      /* responder */ responderIdentifier,
      /* responderDeposit */ responderDeposit.toHexString(),
      /* responderDepositAssetId */ responderDepositAssetId,
      /* abiEncodings */ abiEncodings,
      /* appDefinition */ appDefinition,
      /* appSeqNo */ preProtocolStateChannel!.numProposedApps + 1,
      /* latestState */ initialState,
      /* latestVersionNumber */ 1,
      /* defaultTimeout */ defaultTimeout.toHexString(),
      /* stateTimeout */ stateTimeout.toHexString(),
      /* outcomeType */ outcomeType,
      /* interpreterParamsInternal*/ interpreterParams,
      /* meta */ meta,
    );
    const proposalJson = proposal.toJson();

    const error = yield [
      OP_VALIDATE,
      protocol,
      {
        proposal: proposalJson,
        params,
        role: ProtocolRoles.responder,
        stateChannel: preProtocolStateChannel!.toJson(),
      } as ProposeMiddlewareContext,
    ];
    if (!!error) {
      throw new Error(error);
    }
    logTime(log, substart, `[${processID}] Validated proposal`);
    substart = Date.now();

    // 0ms
    const postProtocolStateChannel = preProtocolStateChannel!.addProposal(proposalJson);

    const setStateCommitment = getSetStateCommitment(context, proposal as AppInstance);
    const setStateCommitmentHash = setStateCommitment.hashToSign();

    const conditionalTxCommitment = getConditionalTransactionCommitment(
      context,
      postProtocolStateChannel,
      proposal as AppInstance,
    );
    const conditionalTxCommitmentHash = conditionalTxCommitment.hashToSign();

    substart = Date.now();
    await assertIsValidSignature(
      getSignerAddressFromPublicIdentifier(initiatorIdentifier),
      setStateCommitmentHash,
      initiatorSignatureOnInitialState,
      `Failed to validate initiator's signature on initial set state commitment in the propose protocol. Process: ${processID}. Our commitment: ${stringify(
        setStateCommitment.toJson(),
      )}. Initial state: ${stringify(initialState)}`,
    );
    logTime(log, substart, `[${processID}] Asserted valid signature responder propose`);

    substart = Date.now();
    await assertIsValidSignature(
      getSignerAddressFromPublicIdentifier(initiatorIdentifier),
      conditionalTxCommitmentHash,
      initiatorSignatureOnConditionalTransaction,
      `Failed to validate initiator's signature on conditional transaction commitment in the propose protocol. Our commitment: ${stringify(
        conditionalTxCommitment.toJson(),
      )}. Initial state: ${stringify(initialState)}`,
    );
    logTime(
      log,
      substart,
      `[${processID}] Asserted valid initiator signature on conditional transaction`,
    );

    substart = Date.now();
    // 12ms
    const responderSignatureOnInitialState = yield [OP_SIGN, setStateCommitmentHash];
    logTime(log, substart, `[${processID}] Signed initial state responder propose`);
    const responderSignatureOnConditionalTransaction = yield [OP_SIGN, conditionalTxCommitmentHash];
    logTime(log, substart, `[${processID}] Signed conditional tx commitment`);
    await setStateCommitment.addSignatures(
      initiatorSignatureOnInitialState,
      responderSignatureOnInitialState as any,
    );
    await conditionalTxCommitment.addSignatures(
      initiatorSignatureOnConditionalTransaction,
      responderSignatureOnConditionalTransaction as any,
    );

    substart = Date.now();
    // 98ms
    // will also save the app array into the state channel
    yield [
      PERSIST_APP_INSTANCE,
      PersistAppType.CreateProposal,
      postProtocolStateChannel,
      proposalJson,
      setStateCommitment,
      conditionalTxCommitment,
    ];
    logTime(log, substart, `[${processID}] Persisted app instance ${proposalJson.identityHash}`);

    // 0ms
    yield [
      IO_SEND,
      {
        protocol,
        processID,
        seq: UNASSIGNED_SEQ_NO,
        to: initiatorIdentifier,
        customData: {
          signature: responderSignatureOnInitialState,
          signature2: responderSignatureOnConditionalTransaction,
        },
      } as ProtocolMessageData,
      postProtocolStateChannel,
    ];

    substart = Date.now();
    logTime(log, start, `[${processID}] Response finished`);
  },
};
