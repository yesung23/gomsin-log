import {
  appleTransactionEventKind,
  hashAppAccountToken,
  type VerifiedAppleNotification,
  type VerifiedAppleTransaction,
} from '../_shared/appleIapContract.ts';

export type VerifiedNotificationPersistenceInput = {
  notification: VerifiedAppleNotification;
  transaction: VerifiedAppleTransaction | null;
  notificationJwsSha256: string;
  transactionJwsSha256: string | null;
  receivedAtMs: number;
};

export async function buildVerifiedNotificationRpcArgs(
  input: VerifiedNotificationPersistenceInput,
): Promise<Record<string, unknown>> {
  const {
    notification,
    transaction,
    notificationJwsSha256,
    transactionJwsSha256,
    receivedAtMs,
  } = input;
  const eventKind = appleTransactionEventKind(notification.notificationType);
  const consumptionRequest = notification.notificationType === 'CONSUMPTION_REQUEST';
  const hasVerifiedReference = transaction != null && transactionJwsSha256 != null &&
    (consumptionRequest || eventKind != null);
  const referenced = hasVerifiedReference ? transaction : null;

  return {
    p_notification_uuid: notification.notificationUUID,
    p_environment: notification.environment,
    p_notification_type: notification.notificationType,
    p_subtype: notification.subtype ?? null,
    p_notification_transaction_id: transaction?.transactionId ?? null,
    p_notification_original_transaction_id: transaction?.originalTransactionId ?? null,
    p_notification_signed_date_ms: notification.signedDate,
    p_notification_payload_hash: notificationJwsSha256,
    p_received_at_ms: receivedAtMs,
    p_consumption_request_reason: consumptionRequest
      ? notification.data?.consumptionRequestReason ?? null
      : null,
    p_transaction_id: referenced?.transactionId ?? null,
    p_transaction_original_transaction_id: referenced?.originalTransactionId ?? null,
    p_product_id: referenced?.productId ?? null,
    p_product_type: referenced?.type ?? null,
    p_bundle_id: referenced?.bundleId ?? null,
    p_app_account_token_hash: referenced?.appAccountToken
      ? await hashAppAccountToken(referenced.appAccountToken)
      : null,
    p_purchase_date_ms: referenced?.purchaseDate ?? null,
    p_transaction_signed_date_ms: referenced?.signedDate ?? null,
    p_expires_date_ms: referenced?.expiresDate ?? null,
    p_revocation_date_ms: referenced?.revocationDate ?? null,
    p_event_kind: referenced && eventKind ? eventKind : null,
    p_transaction_payload_hash: referenced ? transactionJwsSha256 : null,
    p_quantity: referenced?.quantity ?? (referenced ? 1 : null),
    p_revocation_type: referenced?.revocationType ?? null,
    p_revocation_percentage: referenced?.revocationPercentage ?? null,
  };
}
