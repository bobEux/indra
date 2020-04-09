import { IMessagingService, IStoreService } from "@connext/types";
import { Wallet } from "ethers";
import { JsonRpcProvider, TransactionRequest } from "ethers/providers";
import { parseEther } from "ethers/utils";

import { Node } from "../node";

import { MemoryLockService, MemoryMessagingService, MemoryStoreServiceFactory } from "./services";
import {
  A_PRIVATE_KEY,
  B_PRIVATE_KEY,
  C_PRIVATE_KEY,
} from "./test-constants.jest";
import { Logger } from "./logger";
import { ChannelSigner } from "@connext/crypto";

export const env = {
  logLevel: process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL, 10) : 0,
};

export interface NodeContext {
  node: Node;
  store: IStoreService;
}

export interface SetupContext {
  [nodeName: string]: NodeContext;
}

export async function setup(
  global: any,
  nodeCPresent: boolean = false,
  newExtendedPrvKey: boolean = false,
  messagingService: IMessagingService = new MemoryMessagingService(),
  storeServiceFactory = new MemoryStoreServiceFactory(),
): Promise<SetupContext> {
  const setupContext: SetupContext = {};

  const nodeConfig = { STORE_KEY_PREFIX: "test" };
  const provider = new JsonRpcProvider(global["wallet"].provider.connection.url);

  const prvKeyA = A_PRIVATE_KEY;
  let prvKeyB = B_PRIVATE_KEY;

  if (newExtendedPrvKey) {
    const newExtendedPrvKeys = await generateNewFundedExtendedPrvKeys(
      global["wallet"].privateKey,
      provider,
    );
    prvKeyB = newExtendedPrvKeys.B_PRV_KEY;
  }

  const lockService = new MemoryLockService();

  const channelSignerA = new ChannelSigner(
    prvKeyA,
    (await provider.getNetwork()).chainId,
  );

  const storeServiceA = storeServiceFactory.createStoreService();
  const nodeA = await Node.create(
    messagingService,
    storeServiceA,
    global["network"],
    nodeConfig,
    provider,
    channelSignerA,
    lockService,
    0,
    new Logger("CreateClient", env.logLevel, true, "A"),
  );

  setupContext["A"] = {
    node: nodeA,
    store: storeServiceA,
  };

  const channelSignerB = new ChannelSigner(
    prvKeyB,
    provider.network.chainId,
  );
  const storeServiceB = storeServiceFactory.createStoreService();
  const nodeB = await Node.create(
    messagingService,
    storeServiceB,
    global["network"],
    nodeConfig,
    provider,
    channelSignerB,
    lockService,
    0,
    new Logger("CreateClient", env.logLevel, true, "B"),
  );
  setupContext["B"] = {
    node: nodeB,
    store: storeServiceB,
  };

  let nodeC: Node;
  if (nodeCPresent) {
    const channelSignerC = new ChannelSigner(
      C_PRIVATE_KEY,
      provider.network.chainId,
    );
    const storeServiceC = storeServiceFactory.createStoreService();
    nodeC = await Node.create(
      messagingService,
      storeServiceC,
      global["network"],
      nodeConfig,
      provider,
      channelSignerC,
      lockService,
      0,
      new Logger("CreateClient", env.logLevel, true, "C"),
    );
    setupContext["C"] = {
      node: nodeC,
      store: storeServiceC,
    };
  }

  return setupContext;
}

export async function generateNewFundedWallet(fundedPrivateKey: string, provider: JsonRpcProvider) {
  const fundedWallet = new Wallet(fundedPrivateKey, provider);
  const wallet = Wallet.createRandom().connect(provider);

  const transactionToA: TransactionRequest = {
    to: wallet.address,
    value: parseEther("20").toHexString(),
  };
  await fundedWallet.sendTransaction(transactionToA);
  return wallet;
}

export async function generateNewFundedExtendedPrvKeys(
  fundedPrivateKey: string,
  provider: JsonRpcProvider,
) {
  const fundedWallet = new Wallet(fundedPrivateKey, provider);
  const walletA = Wallet.createRandom();
  const walletB = Wallet.createRandom();

  const transactionToA: TransactionRequest = {
    to: walletA.address,
    value: parseEther("1").toHexString(),
  };
  const transactionToB: TransactionRequest = {
    to: walletB.address,
    value: parseEther("1").toHexString(),
  };
  await fundedWallet.sendTransaction(transactionToA);
  await fundedWallet.sendTransaction(transactionToB);
  return {
    A_PRV_KEY: walletA.privateKey,
    B_PRV_KEY: walletB.privateKey,
  };
}
