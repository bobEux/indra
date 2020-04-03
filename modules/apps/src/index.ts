import { AppRegistryType } from "./shared";
import { CoinBalanceRefundAppRegistryInfo } from "./CoinBalanceRefundApp";
import { DepositAppRegistryInfo } from "./DepositApp";
import { FastSignedTransferAppRegistryInfo } from "./FastSignedTransferApp";
import { HashLockTransferAppRegistryInfo } from "./HashLockTransferApp";
import { SimpleLinkedTransferAppRegistryInfo } from "./SimpleLinkedTransferApp";
import { SimpleSignedTransferAppRegistryInfo } from "./SimpleSignedTransferApp";
import { SimpleTwoPartySwapAppRegistryInfo } from "./SimpleTwoPartySwapApp";
import { WithdrawAppRegistryInfo } from "./WithdrawApp";

export const AppRegistry: AppRegistryType = [
  FastSignedTransferAppRegistryInfo,
  SimpleLinkedTransferAppRegistryInfo,
  SimpleSignedTransferAppRegistryInfo,
  SimpleTwoPartySwapAppRegistryInfo,
  CoinBalanceRefundAppRegistryInfo,
  WithdrawAppRegistryInfo,
  HashLockTransferAppRegistryInfo,
  DepositAppRegistryInfo,
];

export * from "./shared";
export * from "./CoinBalanceRefundApp";
export * from "./FastSignedTransferApp";
export * from "./HashLockTransferApp";
export * from "./SimpleLinkedTransferApp";
export * from "./SimpleSignedTransferApp";
export * from "./SimpleTwoPartySwapApp";
export * from "./WithdrawApp";
export * from "./DepositApp";

export {
  FastSignedTransferAppRegistryInfo,
  AppRegistryType,
  SimpleLinkedTransferAppRegistryInfo,
  SimpleSignedTransferAppRegistryInfo,
  SimpleTwoPartySwapAppRegistryInfo,
  DepositAppRegistryInfo,
  CoinBalanceRefundAppRegistryInfo,
};
