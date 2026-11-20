/*
 * An Android phone is a device too.
 *
 * Its last hop is Firebase Cloud Messaging, and what it registers is the
 * token FCM gave it: kept as the endpoint, since it is what names the
 * device and what the unique index keeps one row for. FCM has one address,
 * so nothing here is an address the worker would be told to call.
 */
alter table push_subscription drop constraint push_subscription_kind_check;
alter table push_subscription add constraint push_subscription_kind_check
  check (kind in ('web', 'apns', 'fcm'));
