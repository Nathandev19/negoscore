// Noms d'événements analytics, partagés par le navigateur et le serveur.
// Aucune donnée de deal, aucun email : seulement ces propriétés.

export const ANALYTICS_EVENTS = {
  landingView: "landing_view",
  inputStarted: "input_started",
  analysisSubmitted: "analysis_submitted",
  analysisCompleted: "analysis_completed",
  analysisFailed: "analysis_failed",
  resultViewed: "result_viewed",
  paywallEmailShown: "paywall_email_shown",
  emailSubmitted: "email_submitted",
  magicLinkClicked: "magic_link_clicked",
  messageCopied: "message_copied",
  secondAnalysisAttempt: "second_analysis_attempt",
  paywallPaymentShown: "paywall_payment_shown",
  checkoutStarted: "checkout_started",
  purchaseCompleted: "purchase_completed",
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
export type AnalyticsProperties = Record<string, string | number | boolean | null>;
