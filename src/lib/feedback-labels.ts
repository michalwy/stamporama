import type { FeedbackKind } from "./feedback-rules";

// The words of the "Report a problem" dialog (#2720). Inside the app they are English like the rest
// of it; on a page shared with a customer they follow that page's language where one of these is
// written, and English otherwise — the same rule every shared document's own labels follow.

export interface FeedbackLabels {
  /** The discreet link under a shared page, and the dialog's title. */
  entry: string;
  kind: Record<FeedbackKind, string>;
  message: string;
  messagePlaceholder: string;
  contact: string;
  contactPlaceholder: string;
  /** One line under the form saying what rides along. */
  attached: string;
  send: string;
  sending: string;
  cancel: string;
  sent: string;
  failed: string;
  tooMany: string;
}

const LABELS: Record<string, FeedbackLabels> = {
  en: {
    entry: "Report a problem",
    kind: { problem: "Problem", idea: "Idea", question: "Question" },
    message: "What would you like to tell us?",
    messagePlaceholder: "What you did, what you expected and what happened",
    contact: "How to reach you (optional)",
    contactPlaceholder: "Email address",
    attached: "The page's address, your browser and window size are sent with it.",
    send: "Send",
    sending: "Sending…",
    cancel: "Cancel",
    sent: "Thank you — your report was sent",
    failed: "The report could not be sent. Try again in a moment.",
    tooMany: "Too many reports from this address. Try again later.",
  },
  pl: {
    entry: "Zgłoś problem",
    kind: { problem: "Problem", idea: "Pomysł", question: "Pytanie" },
    message: "Co chcesz nam przekazać?",
    messagePlaceholder: "Co zostało zrobione, czego się spodziewano i co się stało",
    contact: "Kontakt do Ciebie (opcjonalnie)",
    contactPlaceholder: "Adres e-mail",
    attached: "Razem ze zgłoszeniem wysyłany jest adres strony, przeglądarka i rozmiar okna.",
    send: "Wyślij",
    sending: "Wysyłanie…",
    cancel: "Anuluj",
    sent: "Dziękujemy — zgłoszenie zostało wysłane",
    failed: "Nie udało się wysłać zgłoszenia. Spróbuj ponownie za chwilę.",
    tooMany: "Zbyt wiele zgłoszeń z tego adresu. Spróbuj ponownie później.",
  },
  de: {
    entry: "Problem melden",
    kind: { problem: "Problem", idea: "Idee", question: "Frage" },
    message: "Was möchten Sie uns mitteilen?",
    messagePlaceholder: "Was Sie getan haben, was Sie erwartet haben und was passiert ist",
    contact: "Wie wir Sie erreichen (optional)",
    contactPlaceholder: "E-Mail-Adresse",
    attached: "Die Adresse der Seite, Ihr Browser und die Fenstergröße werden mitgesendet.",
    send: "Senden",
    sending: "Wird gesendet…",
    cancel: "Abbrechen",
    sent: "Danke — Ihre Meldung wurde gesendet",
    failed: "Die Meldung konnte nicht gesendet werden. Versuchen Sie es gleich noch einmal.",
    tooMany: "Zu viele Meldungen von dieser Adresse. Versuchen Sie es später erneut.",
  },
};

export const FEEDBACK_LABEL_LANGUAGES: readonly string[] = Object.keys(LABELS).sort();

/** The dialog's words in `language`, or English where it has none. */
export function feedbackLabels(language: string | null | undefined): FeedbackLabels {
  const code = (language ?? "").trim().toLowerCase().split("-")[0];
  return LABELS[code] ?? LABELS.en;
}
