import { TrackView } from "@/components/analytics/track-view";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";

export function PaywallView() {
  return <TrackView event={ANALYTICS_EVENTS.paywallPaymentShown} />;
}
