import { UNASSIGNED_SEQ_NO } from "../constants";
import { BigNumber } from "ethers/utils";
import { fromExtendedKey } from "ethers/utils/hdnode";

import { getSetStateCommitment } from "../ethereum";
import { AppInstance, StateChannel } from "../models";
import { Store } from "../store";
import {
  Context,
  NetworkContext,
  Opcode,
  Protocol,
  ProtocolExecutionFlow,
  ProtocolMessage,
  ProtocolParameters,
  UninstallVirtualAppProtocolParams,
} from "../types";
import { xkeyKthAddress } from "../xkeys";

import { assertIsValidSignature, computeTokenIndexedFreeBalanceIncrements } from "./utils";

/**
 * File notes:
 *
 * FIXME: This file should use the xkeyKthAddress function instead of a
 *        file-specific helper.
 *
 * FIXME: Need to verify the proper private key is being used in signing
 *        here
 *
 * FIXME: Need to make adjustments to the `propose` protocol to allow for
 *        the intermediary to refuse to support a virtual app (rn they only
 *        find out in a meaningful way through the `INSTALL_VIRTUAL_EVENT`
 *        triggered at the end of the protocol, or parsing every protocol
 *        message and trying to stop a protocol mid-execution)
 */

function xkeyTo0thAddress(xpub: string) {
  return fromExtendedKey(xpub).derivePath("0").address;
}

const {
  OP_SIGN,
  IO_SEND_AND_WAIT,
  IO_SEND,
  PERSIST_STATE_CHANNEL,
  // WRITE_COMMITMENT // TODO: add calls to WRITE_COMMITMENT after sigs collected
} = Opcode;

/**
 * @description This exchange is described at the following URL:
 *
 * specs.counterfactual.com/en/latest/protocols/uninstall-virtual-app.html
 */
export const UNINSTALL_VIRTUAL_APP_PROTOCOL: ProtocolExecutionFlow = {
  /**
   * Sequence 0 of the UNINSTALL_VIRTUAL_APP_PROTOCOL requires the initiator
   * party to request to the intermediary to lock the state of the virtual app,
   * then upon receiving confirmation it has been locked, then request to the
   * intermediary to uninstall the agreement that was signed locking up the
   * intermediary's capital based on the outcome of the virtul app at the
   * agreed upon locked state.
   *
   * @param {Context} context
   */

  0 /* Initiating */: async function*(context: Context) {
    throw Error(`Virtual app protocols not supported.`);
    const {
      message: { processID, params },
      stateChannelsMap,
      network,
    } = context;

    const { intermediaryXpub, responderXpub } = params as UninstallVirtualAppProtocolParams;

    const [
      stateChannelWithAllThreeParties,
      stateChannelWithIntermediary,
      stateChannelWithResponding,
      timeLockedPassThroughAppInstance,
    ] = await getUpdatedStateChannelAndAppInstanceObjectsForInitiating(
      stateChannelsMap,
      params!,
      network,
    );

    const intermediaryFreeBalanceAddress = xkeyKthAddress(intermediaryXpub, 0);
    const intermediaryEphemeralAddress = xkeyKthAddress(
      intermediaryXpub,
      timeLockedPassThroughAppInstance.appSeqNo,
    );

    const responderEphemeralAddress = xkeyKthAddress(
      responderXpub,
      timeLockedPassThroughAppInstance.appSeqNo,
    );

    const timeLockedPassThroughSetStateCommitment = getSetStateCommitment(
      context,
      timeLockedPassThroughAppInstance,
    );

    const initiatingSignatureOnTimeLockedPassThroughSetStateCommitment = yield [
      OP_SIGN,
      timeLockedPassThroughSetStateCommitment,
      timeLockedPassThroughAppInstance.appSeqNo,
    ];

    const m1 = {
      params,
      processID,
      protocol: Protocol.UninstallVirtualApp,
      seq: 1,
      toXpub: intermediaryXpub,
      customData: {
        signature: initiatingSignatureOnTimeLockedPassThroughSetStateCommitment,
      },
    } as ProtocolMessage;

    const m4 = (yield [IO_SEND_AND_WAIT, m1]) as ProtocolMessage;

    const {
      customData: {
        signature: responderSignatureOnTimeLockedPassThroughSetStateCommitment,
        signature2: intermediarySignatureOnTimeLockedPassThroughSetStateCommitment,
      },
    } = m4;

    assertIsValidSignature(
      responderEphemeralAddress,
      timeLockedPassThroughSetStateCommitment,
      responderSignatureOnTimeLockedPassThroughSetStateCommitment,
    );

    assertIsValidSignature(
      intermediaryEphemeralAddress,
      timeLockedPassThroughSetStateCommitment,
      intermediarySignatureOnTimeLockedPassThroughSetStateCommitment,
    );

    const aliceIngridAppDisactivationCommitment = getSetStateCommitment(
      context,
      stateChannelWithIntermediary.freeBalance,
    );

    // use fb address for fb app updates
    const initiatingSignatureOnAliceIngridAppDisactivationCommitment = yield [
      OP_SIGN,
      aliceIngridAppDisactivationCommitment,
    ];

    const m5 = {
      processID,
      protocol: Protocol.UninstallVirtualApp,
      seq: UNASSIGNED_SEQ_NO,
      toXpub: intermediaryXpub,
      customData: {
        signature: initiatingSignatureOnAliceIngridAppDisactivationCommitment,
      },
    } as ProtocolMessage;

    const m8 = (yield [IO_SEND_AND_WAIT, m5]) as ProtocolMessage;

    const {
      customData: { signature: intermediarySignatureOnAliceIngridAppDisactivationCommitment },
    } = m8;

    // use fb address for fb app updates
    assertIsValidSignature(
      intermediaryFreeBalanceAddress,
      aliceIngridAppDisactivationCommitment,
      intermediarySignatureOnAliceIngridAppDisactivationCommitment,
    );

    yield [
      PERSIST_STATE_CHANNEL,
      [stateChannelWithIntermediary, stateChannelWithAllThreeParties, stateChannelWithResponding],
    ];

    context.stateChannelsMap.set(
      stateChannelWithIntermediary.multisigAddress,
      stateChannelWithIntermediary,
    );

    context.stateChannelsMap.set(
      stateChannelWithAllThreeParties.multisigAddress,
      stateChannelWithAllThreeParties,
    );

    context.stateChannelsMap.set(
      stateChannelWithResponding.multisigAddress,
      stateChannelWithResponding,
    );
  },

  1 /* Intermediary */: async function*(context: Context) {
    throw Error(`Virtual app protocols not supported.`);
    const {
      message: {
        processID,
        params,
        customData: { signature: initiatingSignatureOnTimeLockedPassThroughSetStateCommitment },
      },
      stateChannelsMap,
      network,
    } = context;

    const { initiatorXpub, responderXpub } = params as UninstallVirtualAppProtocolParams;

    const [
      stateChannelWithAllThreeParties,
      stateChannelWithInitiating,
      stateChannelWithResponding,
      timeLockedPassThroughAppInstance,
    ] = await getUpdatedStateChannelAndAppInstanceObjectsForIntermediary(
      stateChannelsMap,
      params!,
      network,
    );

    const initiatorFreeBalanceAddress = xkeyKthAddress(initiatorXpub, 0);
    const initiatorEphemeralAddress = xkeyKthAddress(
      initiatorXpub,
      timeLockedPassThroughAppInstance.appSeqNo,
    );

    const responderFreeBalanceAddress = xkeyKthAddress(responderXpub, 0);
    const responderEphemeralAddress = xkeyKthAddress(
      responderXpub,
      timeLockedPassThroughAppInstance.appSeqNo,
    );

    const timeLockedPassThroughSetStateCommitment = getSetStateCommitment(
      context,
      timeLockedPassThroughAppInstance,
    );

    assertIsValidSignature(
      initiatorEphemeralAddress,
      timeLockedPassThroughSetStateCommitment,
      initiatingSignatureOnTimeLockedPassThroughSetStateCommitment,
    );

    const intermediarySignatureOnTimeLockedPassThroughSetStateCommitment = yield [
      OP_SIGN,
      timeLockedPassThroughSetStateCommitment,
      timeLockedPassThroughAppInstance.appSeqNo,
    ];

    const m2 = {
      processID,
      params,
      protocol: Protocol.UninstallVirtualApp,
      seq: 2,
      toXpub: responderXpub,
      customData: {
        signature: initiatingSignatureOnTimeLockedPassThroughSetStateCommitment,
        signature2: intermediarySignatureOnTimeLockedPassThroughSetStateCommitment,
      },
    } as ProtocolMessage;

    const m3 = (yield [IO_SEND_AND_WAIT, m2]) as ProtocolMessage;

    const {
      customData: { signature: respondingSignatureOnTimeLockedPassThroughSetStateCommitment },
    } = m3;

    assertIsValidSignature(
      responderEphemeralAddress,
      timeLockedPassThroughSetStateCommitment,
      respondingSignatureOnTimeLockedPassThroughSetStateCommitment,
    );

    const m4 = {
      processID,
      protocol: Protocol.UninstallVirtualApp,
      seq: UNASSIGNED_SEQ_NO,
      toXpub: initiatorXpub,
      customData: {
        signature: respondingSignatureOnTimeLockedPassThroughSetStateCommitment,
        signature2: intermediarySignatureOnTimeLockedPassThroughSetStateCommitment,
      },
    } as ProtocolMessage;

    const m5 = (yield [IO_SEND_AND_WAIT, m4]) as ProtocolMessage;

    const {
      customData: { signature: initiatingSignatureOnAliceIngridAppDisactivationCommitment },
    } = m5;

    const aliceIngridAppDisactivationCommitment = getSetStateCommitment(
      context,
      stateChannelWithInitiating.freeBalance,
    );

    // use fb address for fb app
    assertIsValidSignature(
      initiatorFreeBalanceAddress,
      aliceIngridAppDisactivationCommitment,
      initiatingSignatureOnAliceIngridAppDisactivationCommitment,
    );

    const intermediarySignatureOnAliceIngridAppDisactivationCommitment = yield [
      OP_SIGN,
      aliceIngridAppDisactivationCommitment,
    ];

    const ingridBobAppDisactivationCommitment = getSetStateCommitment(
      context,
      stateChannelWithResponding.freeBalance,
    );

    // use fb address for fb app
    const intermediarySignatureOnIngridBobAppDisactivationCommitment = yield [
      OP_SIGN,
      ingridBobAppDisactivationCommitment,
    ];

    const m6 = {
      processID,
      protocol: Protocol.UninstallVirtualApp,
      seq: UNASSIGNED_SEQ_NO,
      toXpub: responderXpub,
      customData: {
        signature: intermediarySignatureOnIngridBobAppDisactivationCommitment,
      },
    } as ProtocolMessage;

    const m7 = (yield [IO_SEND_AND_WAIT, m6]) as ProtocolMessage;

    const {
      customData: { signature: respondingSignatureOnIngridBobAppDisactivationCommitment },
    } = m7;

    // use fb address for fb app
    assertIsValidSignature(
      responderFreeBalanceAddress,
      ingridBobAppDisactivationCommitment,
      respondingSignatureOnIngridBobAppDisactivationCommitment,
    );

    context.stateChannelsMap.set(
      stateChannelWithInitiating.multisigAddress,
      stateChannelWithInitiating,
    );

    context.stateChannelsMap.set(
      stateChannelWithAllThreeParties.multisigAddress,
      stateChannelWithAllThreeParties,
    );

    context.stateChannelsMap.set(
      stateChannelWithResponding.multisigAddress,
      stateChannelWithResponding,
    );

    yield [
      PERSIST_STATE_CHANNEL,
      [stateChannelWithInitiating, stateChannelWithAllThreeParties, stateChannelWithResponding],
    ];

    const m8 = {
      processID,
      protocol: Protocol.UninstallVirtualApp,
      seq: UNASSIGNED_SEQ_NO,
      toXpub: initiatorXpub,
      customData: {
        signature: intermediarySignatureOnAliceIngridAppDisactivationCommitment,
      },
    } as ProtocolMessage;

    yield [IO_SEND, m8];
  },

  2 /* Responding */: async function*(context: Context) {
    throw Error(`Virtual app protocols not supported.`);
    const {
      message: {
        processID,
        params,
        customData: {
          signature: initiatingSignatureOnTimeLockedPassThroughSetStateCommitment,
          signature2: intermediarySignatureOnTimeLockedPassThroughSetStateCommitment,
        },
      },
      stateChannelsMap,
      network,
    } = context;

    const { initiatorXpub, intermediaryXpub } = params as UninstallVirtualAppProtocolParams;

    const [
      stateChannelWithAllThreeParties,
      stateChannelWithIntermediary,
      stateChannelWithInitiating,
      timeLockedPassThroughAppInstance,
    ] = await getUpdatedStateChannelAndAppInstanceObjectsForResponding(
      stateChannelsMap,
      params!,
      network,
    );

    const initiatorEphemeralAddress = xkeyKthAddress(
      initiatorXpub,
      timeLockedPassThroughAppInstance.appSeqNo,
    );

    const intermediaryFreeBalanceAddress = xkeyKthAddress(intermediaryXpub, 0);
    const intermediaryEphemeralAddress = xkeyKthAddress(
      intermediaryXpub,
      timeLockedPassThroughAppInstance.appSeqNo,
    );

    const timeLockedPassThroughSetStateCommitment = getSetStateCommitment(
      context,
      timeLockedPassThroughAppInstance,
    );

    assertIsValidSignature(
      initiatorEphemeralAddress,
      timeLockedPassThroughSetStateCommitment,
      initiatingSignatureOnTimeLockedPassThroughSetStateCommitment,
    );

    assertIsValidSignature(
      intermediaryEphemeralAddress,
      timeLockedPassThroughSetStateCommitment,
      intermediarySignatureOnTimeLockedPassThroughSetStateCommitment,
    );

    const respondingSignatureOnTimeLockedPassThroughSetStateCommitment = yield [
      OP_SIGN,
      timeLockedPassThroughSetStateCommitment,
      timeLockedPassThroughAppInstance.appSeqNo,
    ];

    const m3 = {
      processID,
      protocol: Protocol.UninstallVirtualApp,
      seq: UNASSIGNED_SEQ_NO,
      toXpub: intermediaryXpub,
      customData: {
        signature: respondingSignatureOnTimeLockedPassThroughSetStateCommitment,
      },
    } as ProtocolMessage;

    const m6 = (yield [IO_SEND_AND_WAIT, m3]) as ProtocolMessage;

    const {
      customData: { signature: intermediarySignatureOnIngridBobAppDisactivationCommitment },
    } = m6;

    const ingridBobAppDisactivationCommitment = getSetStateCommitment(
      context,
      stateChannelWithIntermediary.freeBalance,
    );

    // free balance addr for free balance app
    assertIsValidSignature(
      intermediaryFreeBalanceAddress,
      ingridBobAppDisactivationCommitment,
      intermediarySignatureOnIngridBobAppDisactivationCommitment,
    );

    // free balance addr for free balance app
    const respondingSignatureOnIngridBobAppDisactivationCommitment = yield [
      OP_SIGN,
      ingridBobAppDisactivationCommitment,
    ];

    yield [
      PERSIST_STATE_CHANNEL,
      [stateChannelWithInitiating, stateChannelWithAllThreeParties, stateChannelWithIntermediary],
    ];

    const m7 = {
      processID,
      protocol: Protocol.UninstallVirtualApp,
      seq: UNASSIGNED_SEQ_NO,
      toXpub: intermediaryXpub,
      customData: {
        signature: respondingSignatureOnIngridBobAppDisactivationCommitment,
      },
    } as ProtocolMessage;

    yield [IO_SEND, m7];

    context.stateChannelsMap.set(
      stateChannelWithIntermediary.multisigAddress,
      stateChannelWithIntermediary,
    );

    context.stateChannelsMap.set(
      stateChannelWithAllThreeParties.multisigAddress,
      stateChannelWithAllThreeParties,
    );

    context.stateChannelsMap.set(
      stateChannelWithInitiating.multisigAddress,
      stateChannelWithInitiating,
    );
  },
};

async function getStateChannelFromMapWithOwners(
  stateChannelsMap: Map<string, StateChannel>,
  userXpubs: string[],
  network: NetworkContext,
): Promise<StateChannel> {
  const multisigAddress = await Store.getMultisigAddressWithCounterpartyFromMap(
    stateChannelsMap,
    userXpubs,
    network.ProxyFactory,
    network.MinimumViableMultisig,
    network.provider,
  );
  return stateChannelsMap.get(multisigAddress)!;
}

async function getUpdatedStateChannelAndAppInstanceObjectsForInitiating(
  stateChannelsMap: Map<string, StateChannel>,
  params: ProtocolParameters,
  network: NetworkContext,
): Promise<[StateChannel, StateChannel, StateChannel, AppInstance]> {
  const {
    intermediaryXpub,
    responderXpub,
    initiatorXpub,
    targetAppIdentityHash,
    targetOutcome,
  } = params as UninstallVirtualAppProtocolParams;

  const initiatorAddress = xkeyTo0thAddress(initiatorXpub);
  const intermediaryAddress = xkeyTo0thAddress(intermediaryXpub);
  const responderAddress = xkeyTo0thAddress(responderXpub);

  const [
    stateChannelWithAllThreeParties,
    stateChannelWithIntermediary,
    stateChannelWithResponding,
  ] = [
    await getStateChannelFromMapWithOwners(
      stateChannelsMap,
      [initiatorXpub, responderXpub, intermediaryXpub],
      network,
    ),

    await getStateChannelFromMapWithOwners(
      stateChannelsMap,
      [initiatorXpub, intermediaryXpub],
      network,
    ),

    await getStateChannelFromMapWithOwners(
      stateChannelsMap,
      [initiatorXpub, responderXpub],
      network,
    ),
  ];

  const agreement =
    stateChannelWithIntermediary.getSingleAssetTwoPartyIntermediaryAgreementFromVirtualApp(
      targetAppIdentityHash,
    );

  const { tokenAddress } = agreement;

  const timeLockedPassThroughAppInstance = stateChannelWithAllThreeParties.getAppInstance(
    agreement.timeLockedPassThroughIdentityHash,
  );

  const virtualAppInstance = stateChannelWithResponding.getAppInstance(
    timeLockedPassThroughAppInstance.state["targetAppIdentityHash"], // TODO: type
  );

  const virtualAppHasExpired = (timeLockedPassThroughAppInstance.state[
    "switchesOutcomeAt"
  ] as BigNumber).lte(await network.provider.getBlockNumber());

  const tokenIndexedIncrements = await computeTokenIndexedFreeBalanceIncrements(
    virtualAppHasExpired ? timeLockedPassThroughAppInstance : virtualAppInstance,
    network.provider,
  );

  return [
    /**
     * Remove the agreement from the app with the intermediary
     */
    stateChannelWithAllThreeParties.removeAppInstance(
      timeLockedPassThroughAppInstance.identityHash,
    ),

    /**
     * Remove the agreement from the app with the intermediary
     */
    stateChannelWithIntermediary.removeSingleAssetTwoPartyIntermediaryAgreement(
      virtualAppInstance.identityHash,
      {
        [intermediaryAddress]: tokenIndexedIncrements[tokenAddress][responderAddress],

        [initiatorAddress]: tokenIndexedIncrements[tokenAddress][initiatorAddress],
      },
      tokenAddress,
    ),

    /**
     * Remove the virtual app itself
     */
    stateChannelWithResponding.removeAppInstance(virtualAppInstance.identityHash),

    /**
     * Remove the TimeLockedPassThrough AppInstance in the 3-way channel
     */
    timeLockedPassThroughAppInstance.setState({
      ...timeLockedPassThroughAppInstance.state,
      switchesOutcomeAt: 0,
      defaultOutcome: targetOutcome,
    }),
  ];
}

async function getUpdatedStateChannelAndAppInstanceObjectsForResponding(
  stateChannelsMap: Map<string, StateChannel>,
  params: ProtocolParameters,
  network: NetworkContext,
): Promise<[StateChannel, StateChannel, StateChannel, AppInstance]> {
  const {
    intermediaryXpub,
    responderXpub,
    initiatorXpub,
    targetAppIdentityHash,
    targetOutcome,
  } = params as UninstallVirtualAppProtocolParams;

  const initiatorAddress = xkeyTo0thAddress(initiatorXpub);
  const intermediaryAddress = xkeyTo0thAddress(intermediaryXpub);
  const responderAddress = xkeyTo0thAddress(responderXpub);

  const [
    stateChannelWithAllThreeParties,
    stateChannelWithIntermediary,
    stateChannelWithInitiating,
  ] = [
    await getStateChannelFromMapWithOwners(
      stateChannelsMap,
      [initiatorXpub, responderXpub, intermediaryXpub],
      network,
    ),

    await getStateChannelFromMapWithOwners(
      stateChannelsMap,
      [responderXpub, intermediaryXpub],
      network,
    ),

    await getStateChannelFromMapWithOwners(
      stateChannelsMap,
      [initiatorXpub, responderXpub],
      network,
    ),
  ];

  const agreement =
    stateChannelWithIntermediary.getSingleAssetTwoPartyIntermediaryAgreementFromVirtualApp(
      targetAppIdentityHash,
    );

  const { tokenAddress } = agreement;

  const timeLockedPassThroughAppInstance = stateChannelWithAllThreeParties.getAppInstance(
    agreement.timeLockedPassThroughIdentityHash,
  );

  const virtualAppInstance = stateChannelWithInitiating.getAppInstance(
    timeLockedPassThroughAppInstance.state["targetAppIdentityHash"], // TODO: type
  );

  const expectedOutcome = await virtualAppInstance.computeOutcomeWithCurrentState(network.provider);

  if (expectedOutcome !== targetOutcome) {
    throw Error(
      "UninstallVirtualApp Protocol: Received targetOutcome that did not match expected outcome based on latest state of Virtual App.",
    );
  }

  const virtualAppHasExpired = (timeLockedPassThroughAppInstance.state[
    "switchesOutcomeAt"
  ] as BigNumber).lte(await network.provider.getBlockNumber());

  const tokenIndexedIncrements = await computeTokenIndexedFreeBalanceIncrements(
    virtualAppHasExpired ? timeLockedPassThroughAppInstance : virtualAppInstance,
    network.provider,
  );

  return [
    /**
     * Remove the agreement from the app with the intermediary
     */
    stateChannelWithAllThreeParties.removeAppInstance(
      timeLockedPassThroughAppInstance.identityHash,
    ),

    /**
     * Remove the agreement from the app with the intermediary
     */
    stateChannelWithIntermediary.removeSingleAssetTwoPartyIntermediaryAgreement(
      virtualAppInstance.identityHash,
      {
        [intermediaryAddress]: tokenIndexedIncrements[tokenAddress][initiatorAddress],

        [responderAddress]: tokenIndexedIncrements[tokenAddress][responderAddress],
      },
      tokenAddress,
    ),

    /**
     * Remove the virtual app itself
     */
    stateChannelWithInitiating.removeAppInstance(virtualAppInstance.identityHash),

    /**
     * Remove the TimeLockedPassThrough AppInstance in the 3-way channel
     */
    timeLockedPassThroughAppInstance.setState({
      ...timeLockedPassThroughAppInstance.state,
      switchesOutcomeAt: 0,
      defaultOutcome: expectedOutcome,
    }),
  ];
}

async function getUpdatedStateChannelAndAppInstanceObjectsForIntermediary(
  stateChannelsMap: Map<string, StateChannel>,
  params: ProtocolParameters,
  network: NetworkContext,
): Promise<[StateChannel, StateChannel, StateChannel, AppInstance]> {
  const {
    intermediaryXpub,
    responderXpub,
    initiatorXpub,
    targetAppIdentityHash,
    targetOutcome,
  } = params as UninstallVirtualAppProtocolParams;

  const initiatorAddress = xkeyTo0thAddress(initiatorXpub);
  const intermediaryAddress = xkeyTo0thAddress(intermediaryXpub);
  const responderAddress = xkeyTo0thAddress(responderXpub);

  const [
    stateChannelWithAllThreeParties,
    stateChannelWithInitiating,
    stateChannelWithResponding,
  ] = [
    await getStateChannelFromMapWithOwners(
      stateChannelsMap,
      [initiatorXpub, responderXpub, intermediaryXpub],
      network,
    ),

    await getStateChannelFromMapWithOwners(
      stateChannelsMap,
      [initiatorXpub, intermediaryXpub],
      network,
    ),

    await getStateChannelFromMapWithOwners(
      stateChannelsMap,
      [intermediaryXpub, responderXpub],
      network,
    ),
  ];

  const agreementWithInitiating =
    stateChannelWithInitiating.getSingleAssetTwoPartyIntermediaryAgreementFromVirtualApp(
      targetAppIdentityHash,
    );

  const { tokenAddress } = agreementWithInitiating;

  const timeLockedPassThroughAppInstance = stateChannelWithAllThreeParties.getAppInstance(
    agreementWithInitiating.timeLockedPassThroughIdentityHash,
  );

  const virtualAppHasExpired = (timeLockedPassThroughAppInstance.state[
    "switchesOutcomeAt"
  ] as BigNumber).lte(await network.provider.getBlockNumber());

  // FIXME: Come up with a better abstraction for this function. In this case,
  // we want to pass in an outcome to use to compute the token indexed free
  // balance increments, but the interfact of the function requires an AppInstance.
  // Notice that I passed in an object for the AppInstance and an additional
  // third parameter which is an `overrideOutcome`. That is generally messy code,
  // so this TODO is to mark that we should improve this abstraction.
  const tokenIndexedIncrements = await computeTokenIndexedFreeBalanceIncrements(
    timeLockedPassThroughAppInstance,
    network.provider,
    virtualAppHasExpired
      ? (timeLockedPassThroughAppInstance.state["defaultOutcome"] as string)
      : targetOutcome,
  );

  return [
    /**
     * Remove the agreement from the 3-party app
     */
    stateChannelWithAllThreeParties.removeAppInstance(
      timeLockedPassThroughAppInstance.identityHash,
    ),

    /**
     * Remove the agreement from the app with the initiating
     */
    stateChannelWithInitiating.removeSingleAssetTwoPartyIntermediaryAgreement(
      timeLockedPassThroughAppInstance.state["targetAppIdentityHash"],
      {
        [intermediaryAddress]: tokenIndexedIncrements[tokenAddress][responderAddress],

        [initiatorAddress]: tokenIndexedIncrements[tokenAddress][initiatorAddress],
      },
      tokenAddress,
    ),

    /**
     * Remove the agreement from the app with the responding
     */
    stateChannelWithResponding.removeSingleAssetTwoPartyIntermediaryAgreement(
      timeLockedPassThroughAppInstance.state["targetAppIdentityHash"],
      {
        [intermediaryAddress]: tokenIndexedIncrements[tokenAddress][initiatorAddress],

        [responderAddress]: tokenIndexedIncrements[tokenAddress][responderAddress],
      },
      tokenAddress,
    ),

    /**
     * Remove the TimeLockedPassThrough AppInstance in the 3-way channel
     */
    timeLockedPassThroughAppInstance.setState({
      ...timeLockedPassThroughAppInstance.state,
      switchesOutcomeAt: 0,
      defaultOutcome: targetOutcome,
    }),
  ];
}
