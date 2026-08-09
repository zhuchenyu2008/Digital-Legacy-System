import { Icon } from "../../components/icons/icon";
import { formatBeijingDateTime } from "../../lib/time/beijing";
export type PublicAuditEvent = Readonly<{
  id: string;
  eventType: string;
  occurredAt: string;
  summary?: string | undefined;
  hash?: string | undefined;
}>;

export function PublicAudit({ events }: Readonly<{ events: readonly PublicAuditEvent[] }>) {
  return (
    <section className="dls-public-audit">
      <h2>
        <Icon name="history" size={22} />
        脱敏审计时间线
      </h2>
      {events.length === 0 ? (
        <p>暂无公开审计事件。</p>
      ) : (
        <ol>
          {events.map((event, index) => (
            <li
              className={
                index === events.length - 1
                  ? "dls-audit-event dls-audit-event--latest"
                  : "dls-audit-event"
              }
              key={event.id}
            >
              <div>
                <strong>{event.eventType}</strong>
                <time>{formatBeijingDateTime(event.occurredAt)}</time>
              </div>
              {event.summary ? <p>{event.summary}</p> : null}
              {event.hash ? <code>{event.hash}</code> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
