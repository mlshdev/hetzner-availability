import {
  GetAccountCommand,
  SESv2Client,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";

import type { Config } from "./config.ts";
import { formatAvailability, type AvailabilityStatus } from "./domain.ts";
import { errorFields, type Logger } from "./logger.ts";

interface AvailabilityEmail {
  readonly subject: string;
  readonly body: string;
}

export function buildAvailabilityEmail(
  newlyAvailable: readonly AvailabilityStatus[],
  allStatuses: readonly AvailabilityStatus[],
  checkedAt: Date,
): AvailabilityEmail {
  const firstAvailability = newlyAvailable[0];
  if (firstAvailability === undefined) {
    throw new Error(
      "Cannot build an availability email without a newly available server",
    );
  }

  const subject =
    newlyAvailable.length === 1
      ? `Hetzner VPS available: ${formatAvailability(firstAvailability)}`
      : `${newlyAvailable.length} Hetzner VPS options are available`;
  const availableLines = newlyAvailable.map(
    (status) => `- ${formatAvailability(status)}`,
  );
  const statusLines = allStatuses.map(
    (status) =>
      `- ${formatAvailability(status)}: ${status.available ? "AVAILABLE" : "unavailable"}`,
  );

  return {
    subject,
    body: [
      "Hetzner Cloud capacity became available for:",
      "",
      ...availableLines,
      "",
      "Current status of all monitored options:",
      ...statusLines,
      "",
      `Checked at: ${checkedAt.toISOString()}`,
      "",
      "Open the Hetzner Cloud Console to create the server while capacity remains available:",
      "https://console.hetzner.cloud/",
    ].join("\n"),
  };
}

export class SesNotifier {
  readonly #client: SESv2Client;
  readonly #fromEmail: string;
  readonly #recipientEmail: string;
  readonly #region: string;
  readonly #timeoutMs: number;
  readonly #logger: Logger;

  constructor(config: Config, logger: Logger) {
    const credentials =
      config.awsSessionToken === undefined
        ? {
            accessKeyId: config.awsAccessKeyId,
            secretAccessKey: config.awsSecretAccessKey,
          }
        : {
            accessKeyId: config.awsAccessKeyId,
            secretAccessKey: config.awsSecretAccessKey,
            sessionToken: config.awsSessionToken,
          };

    this.#client = new SESv2Client({
      region: config.awsRegion,
      credentials,
      maxAttempts: 3,
    });
    this.#fromEmail = config.sesFromEmail;
    this.#recipientEmail = config.sesRecipientEmail;
    this.#region = config.awsRegion;
    this.#timeoutMs = config.requestTimeoutMs;
    this.#logger = logger;
    this.#logger.debug("AWS SES client configured", {
      aws_region: this.#region,
      from_email: this.#fromEmail,
      recipient_email: this.#recipientEmail,
      credentials_present: true,
      session_token_present: config.awsSessionToken !== undefined,
      max_attempts: 3,
      request_timeout_ms: this.#timeoutMs,
      network_connection_attempted: false,
    });
  }

  async validateConnection(): Promise<void> {
    const startedAt = performance.now();
    this.#logger.info("AWS SES credential and service validation started", {
      aws_region: this.#region,
      validation_operation: "GetAccount",
      required_iam_action: "ses:GetAccount",
    });
    this.#logger.debug("AWS SES GetAccount request is being sent", {
      aws_region: this.#region,
    });

    try {
      const result = await this.#client.send(new GetAccountCommand({}), {
        abortSignal: AbortSignal.timeout(this.#timeoutMs),
      });
      this.#logger.debug("AWS SES GetAccount response received", {
        aws_region: this.#region,
        duration_ms: Math.round(performance.now() - startedAt),
        http_status_code: result.$metadata.httpStatusCode ?? null,
        aws_request_id: result.$metadata.requestId ?? null,
        aws_attempts: result.$metadata.attempts ?? null,
        aws_total_retry_delay_ms: result.$metadata.totalRetryDelay ?? null,
      });
      if (result.SendingEnabled !== true) {
        throw new Error(
          `AWS SES credentials are valid, but email sending is disabled in ${this.#region}`,
        );
      }
      this.#logger.info("AWS SES connection and credentials are working", {
        aws_region: this.#region,
        sending_enabled: result.SendingEnabled,
        production_access_enabled: result.ProductionAccessEnabled ?? false,
        enforcement_status: result.EnforcementStatus ?? null,
        max_24_hour_send: result.SendQuota?.Max24HourSend ?? null,
        max_send_rate: result.SendQuota?.MaxSendRate ?? null,
        sent_last_24_hours: result.SendQuota?.SentLast24Hours ?? null,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      this.#logger.error("AWS SES validation failed", {
        aws_region: this.#region,
        validation_operation: "GetAccount",
        duration_ms: Math.round(performance.now() - startedAt),
        ...errorFields(error),
      });
      throw error;
    }
  }

  async sendAvailabilityAlert(
    newlyAvailable: readonly AvailabilityStatus[],
    allStatuses: readonly AvailabilityStatus[],
    checkedAt: Date,
  ): Promise<string | undefined> {
    this.#logger.info("AWS SES availability alert preparation started", {
      newly_available_count: newlyAvailable.length,
      from_email: this.#fromEmail,
      recipient_email: this.#recipientEmail,
    });
    const email = buildAvailabilityEmail(
      newlyAvailable,
      allStatuses,
      checkedAt,
    );
    this.#logger.debug("AWS SES email content built", {
      subject: email.subject,
      text_body_bytes: new TextEncoder().encode(email.body).byteLength,
    });

    const startedAt = performance.now();
    this.#logger.info("AWS SES SendEmail request is being sent", {
      aws_region: this.#region,
      recipient_email: this.#recipientEmail,
    });
    try {
      const result = await this.#client.send(
        new SendEmailCommand({
          FromEmailAddress: this.#fromEmail,
          Destination: { ToAddresses: [this.#recipientEmail] },
          Content: {
            Simple: {
              Subject: { Data: email.subject, Charset: "UTF-8" },
              Body: { Text: { Data: email.body, Charset: "UTF-8" } },
            },
          },
        }),
        { abortSignal: AbortSignal.timeout(this.#timeoutMs) },
      );
      this.#logger.info("AWS SES accepted the availability email", {
        message_id: result.MessageId ?? null,
        aws_request_id: result.$metadata.requestId ?? null,
        http_status_code: result.$metadata.httpStatusCode ?? null,
        aws_attempts: result.$metadata.attempts ?? null,
        duration_ms: Math.round(performance.now() - startedAt),
      });
      return result.MessageId;
    } catch (error) {
      this.#logger.error("AWS SES failed to send the availability email", {
        aws_region: this.#region,
        recipient_email: this.#recipientEmail,
        duration_ms: Math.round(performance.now() - startedAt),
        ...errorFields(error),
      });
      throw error;
    }
  }

  destroy(): void {
    this.#client.destroy();
    this.#logger.debug("AWS SES client resources released");
  }
}
