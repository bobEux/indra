import { xkeyKthAddress } from "@connext/cf-core";
import { IConnextClient, SwapParameters } from "@connext/types";
import { AddressZero, One, Zero } from "ethers/constants";
import { BigNumber, bigNumberify, formatEther, parseEther } from "ethers/utils";

import { inverse } from "../util/bn";
import { createClient } from "../util/client";

export const calculateExchange = (amount: BigNumber, swapRate: string): BigNumber => {
  return bigNumberify(formatEther(amount.mul(parseEther(swapRate))).replace(/\.[0-9]*$/, ""));
};

describe("Swaps", () => {
  let clientA: IConnextClient;
  let tokenAddress: string;
  let nodeFreeBalanceAddress: string;
  let nodePublicIdentifier: string;

  beforeEach(async () => {
    clientA = await createClient();

    tokenAddress = clientA.config.contractAddresses.Token;
    nodePublicIdentifier = clientA.config.nodePublicIdentifier;
    nodeFreeBalanceAddress = xkeyKthAddress(nodePublicIdentifier);
  }, 90_000);

  test("happy case: client swaps eth for tokens successfully", async () => {
    // client deposit and request node collateral
    await clientA.deposit({ amount: parseEther("0.01").toString(), assetId: AddressZero });
    await clientA.requestCollateral(tokenAddress);

    // check balances pre
    const {
      [clientA.freeBalanceAddress]: preSwapFreeBalanceEthClient,
      [nodeFreeBalanceAddress]: preSwapFreeBalanceEthNode,
    } = await clientA.getFreeBalance(AddressZero);
    expect(preSwapFreeBalanceEthClient).toBeBigNumberEq(parseEther("0.01"));
    expect(preSwapFreeBalanceEthNode).toBeBigNumberEq(Zero);

    const {
      [clientA.freeBalanceAddress]: preSwapFreeBalanceTokenClient,
      [nodeFreeBalanceAddress]: preSwapFreeBalanceTokenNode,
    } = await clientA.getFreeBalance(tokenAddress);
    expect(preSwapFreeBalanceTokenNode).toBeBigNumberEq(parseEther("10"));
    expect(preSwapFreeBalanceTokenClient).toBeBigNumberEq(Zero);

    const swapRate = await clientA.getLatestSwapRate(AddressZero, tokenAddress);

    const swapAmount = One;
    const swapParams: SwapParameters = {
      amount: swapAmount.toString(),
      fromAssetId: AddressZero,
      swapRate,
      toAssetId: tokenAddress,
    };
    await clientA.swap(swapParams);

    const {
      [clientA.freeBalanceAddress]: postSwapFreeBalanceEthClient,
      [nodeFreeBalanceAddress]: postSwapFreeBalanceEthNode,
    } = await clientA.getFreeBalance(AddressZero);
    const {
      [clientA.freeBalanceAddress]: postSwapFreeBalanceTokenClient,
      [nodeFreeBalanceAddress]: postSwapFreeBalanceTokenNode,
    } = await clientA.getFreeBalance(tokenAddress);

    expect(postSwapFreeBalanceEthClient).toBeBigNumberEq(
      preSwapFreeBalanceEthClient.sub(swapAmount),
    );
    expect(postSwapFreeBalanceEthNode).toBeBigNumberEq(swapAmount);

    const expectedTokenSwapAmount = calculateExchange(swapAmount, swapRate);
    expect(postSwapFreeBalanceTokenClient).toBeBigNumberEq(expectedTokenSwapAmount);
    expect(postSwapFreeBalanceTokenNode).toBeBigNumberEq(
      preSwapFreeBalanceTokenNode.sub(expectedTokenSwapAmount.toString()),
    );
  });

  test("happy case: client swaps tokens for eth successfully", async () => {
    // client deposit and request node collateral
    await clientA.deposit({ amount: parseEther("10").toString(), assetId: tokenAddress });
    await clientA.requestCollateral(AddressZero);

    // check balances pre
    const {
      [clientA.freeBalanceAddress]: preSwapFreeBalanceEthClient,
      [nodeFreeBalanceAddress]: preSwapFreeBalanceEthNode,
    } = await clientA.getFreeBalance(AddressZero);
    expect(preSwapFreeBalanceEthClient).toBeBigNumberEq(Zero);
    expect(preSwapFreeBalanceEthNode).toBeBigNumberEq(parseEther("0.1"));

    const {
      [clientA.freeBalanceAddress]: preSwapFreeBalanceTokenClient,
      [nodeFreeBalanceAddress]: preSwapFreeBalanceTokenNode,
    } = await clientA.getFreeBalance(tokenAddress);
    expect(preSwapFreeBalanceTokenNode).toBeBigNumberEq(Zero);
    expect(preSwapFreeBalanceTokenClient).toBeBigNumberEq(parseEther("10"));

    const swapRate = await clientA.getLatestSwapRate(AddressZero, tokenAddress);
    const inverseSwapRate = inverse(swapRate);
    console.log("inverseSwapRate: ", inverseSwapRate);

    const swapAmount = parseEther("10");
    console.log("swapAmount: ", swapAmount);
    const swapParams: SwapParameters = {
      amount: swapAmount.toString(),
      fromAssetId: tokenAddress,
      swapRate: inverseSwapRate,
      toAssetId: AddressZero,
    };
    await clientA.swap(swapParams);

    const {
      [clientA.freeBalanceAddress]: postSwapFreeBalanceEthClient,
      [nodeFreeBalanceAddress]: postSwapFreeBalanceEthNode,
    } = await clientA.getFreeBalance(AddressZero);
    const {
      [clientA.freeBalanceAddress]: postSwapFreeBalanceTokenClient,
      [nodeFreeBalanceAddress]: postSwapFreeBalanceTokenNode,
    } = await clientA.getFreeBalance(tokenAddress);

    const expectedEthSwapAmount = calculateExchange(swapAmount, inverseSwapRate);
    expect(postSwapFreeBalanceEthClient).toBeBigNumberEq(expectedEthSwapAmount);
    expect(postSwapFreeBalanceEthNode).toBeBigNumberEq(
      preSwapFreeBalanceEthNode.sub(expectedEthSwapAmount),
    );

    expect(postSwapFreeBalanceTokenClient).toBeBigNumberEq(
      preSwapFreeBalanceTokenClient.sub(swapAmount),
    );
    expect(postSwapFreeBalanceTokenNode).toBeBigNumberEq(swapAmount);
  });
});