import {
  enumify,
  ILoggerService,
  IStoreService,
  NetworkContext,
  Opcode,
  ProtocolMessage,
} from "@connext/types";

export const PersistAppType = enumify({
  CreateProposal: "CreateProposal",
  RemoveProposal: "RemoveProposal",
  CreateInstance: "CreateInstance",
  UpdateInstance: "UpdateInstance",
  RemoveInstance: "RemoveInstance",
  Reject: "Reject",
});
export type PersistAppType = typeof PersistAppType[keyof typeof PersistAppType];

export const PersistCommitmentType = enumify({
  CreateSetup: "CreateSetup",
  CreateSetState: "CreateSetState",
  UpdateSetState: "UpdateSetState",
  CreateConditional: "CreateConditional",
  UpdateConditional: "UpdateConditional",
  CreateWithdrawal: "CreateWithdrawal",
  UpdateWithdrawal: "UpdateWithdrawal",
});
export type PersistCommitmentType =
  typeof PersistCommitmentType[keyof typeof PersistCommitmentType];

export interface IPrivateKeyGenerator {
  (s: string): Promise<string>;
}

export type ProtocolExecutionFlow = {
  [x: number]: (context: Context) => AsyncIterableIterator<any[]>;
};

export type Instruction = Function | Opcode;

// Arguments passed to a protocol execulion flow
export interface Context {
  store: IStoreService;
  log: ILoggerService;
  message: ProtocolMessage;
  network: NetworkContext;
}
