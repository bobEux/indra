import { Contract } from "ethers";
import { BaseProvider } from "ethers/providers";
import { defaultAbiCoder, keccak256 } from "ethers/utils";
import { Memoize } from "typescript-memoize";

import { CounterfactualApp } from "../contracts";
import { appIdentityToHash } from "../ethereum";
import {
  AppIdentity,
  AppInstanceJson,
  AppInterface,
  MultiAssetMultiPartyCoinTransferInterpreterParams,
  multiAssetMultiPartyCoinTransferInterpreterParamsEncoding,
  OutcomeType,
  SingleAssetTwoPartyCoinTransferInterpreterParams,
  singleAssetTwoPartyCoinTransferInterpreterParamsEncoding,
  SolidityValueType,
  TwoPartyFixedOutcomeInterpreterParams,
  twoPartyFixedOutcomeInterpreterParamsEncoding,
} from "../types";
import { bigNumberifyJson, prettyPrintObject, deBigNumberifyJson } from "../utils";

/**
 * Representation of an AppInstance.
 *
 * @property participants The sorted array of public keys used by the users of
 *           this AppInstance for which n-of-n consensus is needed on updates.

 * @property defaultTimeout The default timeout used when a new update is made.

 * @property appInterface An AppInterface object representing the logic this
 *           AppInstance relies on for verifying and proposing state updates.

 * @property latestState The unencoded representation of the latest state.

 * @property latestVersionNumber The versionNumber of the latest signed state update.

 * @property latestTimeout The timeout used in the latest signed state update.

 * @property multiAssetMultiPartyCoinTransferInterpreterParams The limit / maximum amount of funds
 *           to be distributed for an app where the interpreter type is COIN_TRANSFER

 * @property twoPartyOutcomeInterpreterParams Addresses of the two beneficiaries
 *           and the amount that is to be distributed for an app
 *           where the interpreter type is TWO_PARTY_FIXED_OUTCOME
 */
export class AppInstance {
  constructor(
    public readonly participants: string[],
    public readonly defaultTimeout: number,
    public readonly appInterface: AppInterface,
    public readonly appSeqNo: number, // channel nonce at app proposal
    public readonly latestState: any,
    public readonly latestVersionNumber: number, // app nonce
    public readonly latestTimeout: number,
    public readonly outcomeType: OutcomeType,
    public readonly multisigAddress: string,
    public readonly meta?: object,
    private readonly twoPartyOutcomeInterpreterParamsInternal?: TwoPartyFixedOutcomeInterpreterParams,
    private readonly multiAssetMultiPartyCoinTransferInterpreterParamsInternal?: MultiAssetMultiPartyCoinTransferInterpreterParams,
    private readonly singleAssetTwoPartyCoinTransferInterpreterParamsInternal?: SingleAssetTwoPartyCoinTransferInterpreterParams,
  ) {}

  get twoPartyOutcomeInterpreterParams() {
    if (this.outcomeType !== OutcomeType.TWO_PARTY_FIXED_OUTCOME) {
      throw Error(
        `Invalid Accessor. AppInstance has outcomeType ${this.outcomeType}, not TWO_PARTY_FIXED_OUTCOME`,
      );
    }

    return this.twoPartyOutcomeInterpreterParamsInternal!;
  }

  get multiAssetMultiPartyCoinTransferInterpreterParams() {
    if (this.outcomeType !== OutcomeType.MULTI_ASSET_MULTI_PARTY_COIN_TRANSFER) {
      throw Error(
        `Invalid Accessor. AppInstance has outcomeType ${this.outcomeType}, not MULTI_ASSET_MULTI_PARTY_COIN_TRANSFER`,
      );
    }

    return this.multiAssetMultiPartyCoinTransferInterpreterParamsInternal!;
  }

  get singleAssetTwoPartyCoinTransferInterpreterParams() {
    if (this.outcomeType !== OutcomeType.SINGLE_ASSET_TWO_PARTY_COIN_TRANSFER) {
      throw Error(
        `Invalid Accessor. AppInstance has outcomeType ${this.outcomeType}, not SINGLE_ASSET_TWO_PARTY_COIN_TRANSFER `,
      );
    }

    return this.singleAssetTwoPartyCoinTransferInterpreterParamsInternal!;
  }
  public static fromJson(json: AppInstanceJson) {
    const deserialized: AppInstanceJson = bigNumberifyJson(json);

    const interpreterParams = {
      twoPartyOutcomeInterpreterParams: deserialized.twoPartyOutcomeInterpreterParams
        ? bigNumberifyJson(deserialized.twoPartyOutcomeInterpreterParams)
        : undefined,
      singleAssetTwoPartyCoinTransferInterpreterParams: deserialized.singleAssetTwoPartyCoinTransferInterpreterParams
        ? bigNumberifyJson(deserialized.singleAssetTwoPartyCoinTransferInterpreterParams)
        : undefined,
      multiAssetMultiPartyCoinTransferInterpreterParams: deserialized.multiAssetMultiPartyCoinTransferInterpreterParams
        ? bigNumberifyJson(deserialized.multiAssetMultiPartyCoinTransferInterpreterParams)
        : undefined,
    };

    return new AppInstance(
      deserialized.participants,
      deserialized.defaultTimeout,
      deserialized.appInterface,
      deserialized.appSeqNo,
      deserialized.latestState,
      deserialized.latestVersionNumber,
      deserialized.latestTimeout,
      deserialized.outcomeType as any, // OutcomeType is enum, so gives attitude
      deserialized.multisigAddress,
      deserialized.meta,
      interpreterParams.twoPartyOutcomeInterpreterParams,
      interpreterParams.multiAssetMultiPartyCoinTransferInterpreterParams,
      interpreterParams.singleAssetTwoPartyCoinTransferInterpreterParams,
    );
  }

  public toJson(): AppInstanceJson {
    // removes any fields which have an `undefined` value, as that's invalid JSON
    // an example would be having an `undefined` value for the `actionEncoding`
    // of an AppInstance that's not turn based
    return deBigNumberifyJson({
      identityHash: this.identityHash,
      participants: this.participants,
      defaultTimeout: this.defaultTimeout,
      appInterface: {
        ...this.appInterface,
        actionEncoding: this.appInterface.actionEncoding || null,
      },
      appSeqNo: this.appSeqNo,
      latestState: this.latestState,
      latestVersionNumber: this.latestVersionNumber,
      latestTimeout: this.latestTimeout,
      outcomeType: this.outcomeType,
      multisigAddress: this.multisigAddress,
      meta: this.meta,
      twoPartyOutcomeInterpreterParams: this.twoPartyOutcomeInterpreterParamsInternal || null,
      multiAssetMultiPartyCoinTransferInterpreterParams:
        this.multiAssetMultiPartyCoinTransferInterpreterParamsInternal || null,
      singleAssetTwoPartyCoinTransferInterpreterParams:
        this.singleAssetTwoPartyCoinTransferInterpreterParamsInternal || null,
    });
  }

  @Memoize()
  public get identityHash() {
    return appIdentityToHash(this.identity);
  }

  @Memoize()
  public get identity(): AppIdentity {
    return {
      participants: this.participants,
      appDefinition: this.appInterface.addr,
      defaultTimeout: this.defaultTimeout,
      channelNonce: this.appSeqNo,
    };
  }

  @Memoize()
  public get hashOfLatestState() {
    return keccak256(this.encodedLatestState);
  }

  @Memoize()
  // todo(xuanji): we should print better error messages here
  public get encodedLatestState() {
    return defaultAbiCoder.encode([this.appInterface.stateEncoding], [this.latestState]);
  }

  @Memoize()
  public get encodedInterpreterParams() {
    switch (this.outcomeType) {
      case OutcomeType.SINGLE_ASSET_TWO_PARTY_COIN_TRANSFER: {
        return defaultAbiCoder.encode(
          [singleAssetTwoPartyCoinTransferInterpreterParamsEncoding],
          [this.singleAssetTwoPartyCoinTransferInterpreterParams],
        );
      }

      case OutcomeType.MULTI_ASSET_MULTI_PARTY_COIN_TRANSFER: {
        return defaultAbiCoder.encode(
          [multiAssetMultiPartyCoinTransferInterpreterParamsEncoding],
          [this.multiAssetMultiPartyCoinTransferInterpreterParams],
        );
      }

      case OutcomeType.TWO_PARTY_FIXED_OUTCOME: {
        return defaultAbiCoder.encode(
          [twoPartyFixedOutcomeInterpreterParamsEncoding],
          [this.twoPartyOutcomeInterpreterParams],
        );
      }

      default: {
        throw Error("The outcome type in this application logic contract is not supported yet.");
      }
    }
  }

  public get state() {
    return this.latestState;
  }

  public get versionNumber() {
    return this.latestVersionNumber;
  }

  public get timeout() {
    return this.latestTimeout;
  }

  public setState(newState: SolidityValueType, timeout: number = this.defaultTimeout) {
    try {
      defaultAbiCoder.encode([this.appInterface.stateEncoding], [newState]);
    } catch (e) {
      // TODO: Catch ethers.errors.INVALID_ARGUMENT specifically in catch {}

      throw Error(
        `Attempted to setState on an app with an invalid state object.
          - appInstanceIdentityHash = ${this.identityHash}
          - newState = ${prettyPrintObject(newState)}
          - encodingExpected = ${this.appInterface.stateEncoding}
          Error: ${e.message}`,
      );
    }

    return AppInstance.fromJson({
      ...this.toJson(),
      latestState: newState,
      latestVersionNumber: this.versionNumber + 1,
      latestTimeout: timeout,
    });
  }

  public async computeOutcome(state: SolidityValueType, provider: BaseProvider): Promise<string> {
    return this.toEthersContract(provider).functions.computeOutcome(this.encodeState(state));
  }

  public async computeOutcomeWithCurrentState(provider: BaseProvider): Promise<string> {
    return this.computeOutcome(this.state, provider);
  }

  public async computeStateTransition(
    action: SolidityValueType,
    provider: BaseProvider,
  ): Promise<SolidityValueType> {
    const ret: SolidityValueType = {};

    const computedNextState = this.decodeAppState(
      await this.toEthersContract(provider).functions.applyAction(
        this.encodedLatestState,
        this.encodeAction(action),
      ),
    );

    // ethers returns an array of [ <each value by idx>, <each value by key> ]
    // so we need to clean this response before returning
    for (const key in this.state) {
      ret[key] = computedNextState[key];
    }

    return ret;
  }

  public encodeAction(action: SolidityValueType) {
    return defaultAbiCoder.encode([this.appInterface.actionEncoding!], [action]);
  }

  public encodeState(state: SolidityValueType) {
    return defaultAbiCoder.encode([this.appInterface.stateEncoding], [state]);
  }

  public decodeAppState(encodedSolidityValueType: string): SolidityValueType {
    return defaultAbiCoder.decode([this.appInterface.stateEncoding], encodedSolidityValueType)[0];
  }

  public toEthersContract(provider: BaseProvider) {
    return new Contract(this.appInterface.addr, CounterfactualApp.abi, provider);
  }
}
