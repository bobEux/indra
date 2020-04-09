import { DepositConfirmationMessage, MethodParams, DepositStartedMessage, getAssetId, getTokenAddressFromAssetId } from "@connext/types";
import { Contract } from "ethers";
import { One, Two, Zero, AddressZero } from "ethers/constants";
import { JsonRpcProvider } from "ethers/providers";

import { Node } from "../../node";

import { DolphinCoin, NetworkContextForTestSuite } from "../contracts";
import { toBeEq } from "../bignumber-jest-matcher";

import { setup, SetupContext } from "../setup";
import {
  createChannel,
  getFreeBalanceState,
  getTokenIndexedFreeBalanceStates,
  transferERC20Tokens,
  assertMessage,
  deposit,
  GANACHE_CHAIN_ID,
} from "../utils";

expect.extend({ toBeEq });

// NOTE: no deposit started event emitted for responder
export function confirmDepositMessages(
  initiator: Node,
  responder: Node,
  params: MethodParams.Deposit,
) {
  const startedMsg = {
    from: initiator.publicIdentifier,
    type: "DEPOSIT_STARTED_EVENT",
    data: {
      value: params.amount,
    },
  };

  const confirmMsg = {
    from: initiator.publicIdentifier,
    type: "DEPOSIT_CONFIRMED_EVENT",
    data: params,
  };

  initiator.once("DEPOSIT_STARTED_EVENT", (msg: DepositStartedMessage) => {
    assertMessage(msg, startedMsg, ["data.txHash"]);
  });

  initiator.once("DEPOSIT_CONFIRMED_EVENT", (msg: DepositConfirmationMessage) => {
    assertMessage(msg, confirmMsg);
  });

  responder.once("DEPOSIT_CONFIRMED_EVENT", (msg: DepositConfirmationMessage) => {
    assertMessage(msg, confirmMsg);
  });
}

describe("Node method follows spec - deposit", () => {
  let nodeA: Node;
  let nodeB: Node;
  let provider: JsonRpcProvider;
  let multisigAddress: string;

  beforeEach(async () => {
    const context: SetupContext = await setup(global);
    nodeA = context["A"].node;
    nodeB = context["B"].node;
    provider = global["wallet"].provider;

    multisigAddress = await createChannel(nodeA, nodeB);
    expect(multisigAddress).toBeDefined();
    nodeA.off("DEPOSIT_CONFIRMED_EVENT");
    nodeB.off("DEPOSIT_CONFIRMED_EVENT");
  });

  it("has the right balance before an ERC20 deposit has been made", async () => {
    const erc20AssetId = getAssetId(
      GANACHE_CHAIN_ID, 
      (global["network"] as NetworkContextForTestSuite)
        .DolphinCoin,
    );

    const freeBalanceState = await getFreeBalanceState(
      nodeA,
      multisigAddress,
      erc20AssetId,
    );

    expect(Object.values(freeBalanceState)).toMatchObject([Zero, Zero]);
  });

  it("has the right balance for both parties after deposits", async () => {
    const preDepositBalance = await provider.getBalance(multisigAddress);

    await deposit(nodeB, multisigAddress, One, nodeA);
    await deposit(nodeA, multisigAddress, One, nodeB);

    expect(await provider.getBalance(multisigAddress)).toBeEq(preDepositBalance.add(2));

    const freeBalanceState = await getFreeBalanceState(nodeA, multisigAddress);

    expect(Object.values(freeBalanceState)).toMatchObject([One, One]);
  });

  it("updates balances correctly when depositing both ERC20 tokens and ETH", async () => {
    const erc20AssetId = getAssetId(
      GANACHE_CHAIN_ID,
      (global["network"] as NetworkContextForTestSuite)
        .DolphinCoin);

    const erc20Contract = new Contract(
      getTokenAddressFromAssetId(erc20AssetId),
      DolphinCoin.abi,
      global["wallet"].provider,
    );

    await transferERC20Tokens(await nodeA.freeBalanceAddress);
    await transferERC20Tokens(await nodeB.freeBalanceAddress);

    let preDepositBalance = await provider.getBalance(multisigAddress);
    const preDepositERC20Balance = await erc20Contract.functions.balanceOf(multisigAddress);

    await deposit(nodeA, multisigAddress, One, nodeB, erc20AssetId);
    await deposit(nodeB, multisigAddress, One, nodeA, erc20AssetId);

    expect(await provider.getBalance(multisigAddress)).toEqual(preDepositBalance);

    expect(await erc20Contract.functions.balanceOf(multisigAddress)).toEqual(
      preDepositERC20Balance.add(Two),
    );

    await confirmEthAndERC20FreeBalances(
      nodeA, 
      multisigAddress, 
      getTokenAddressFromAssetId(erc20AssetId),
    );

    await confirmEthAndERC20FreeBalances(
      nodeB, 
      multisigAddress, 
      getTokenAddressFromAssetId(erc20AssetId),
    );

    // now deposits ETH

    preDepositBalance = await provider.getBalance(multisigAddress);

    await deposit(nodeA, multisigAddress, One, nodeB);
    await deposit(nodeB, multisigAddress, One, nodeA);

    expect(await provider.getBalance(multisigAddress)).toBeEq(preDepositBalance.add(2));

    const freeBalanceState = await getFreeBalanceState(nodeA, multisigAddress);

    expect(Object.values(freeBalanceState)).toMatchObject([One, One]);
  });
});

async function confirmEthAndERC20FreeBalances(
  node: Node,
  multisigAddress: string,
  erc20ContractAddress: string,
) {
  const tokenIndexedFreeBalances = await getTokenIndexedFreeBalanceStates(node, multisigAddress);

  expect(Object.values(tokenIndexedFreeBalances[AddressZero])).toMatchObject([
    Zero,
    Zero,
  ]);

  expect(Object.values(tokenIndexedFreeBalances[erc20ContractAddress])).toMatchObject([One, One]);
}
