import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AnimatePresence,
  MotionConfig,
  motion,
} from "motion/react";
import {
  ArrowCounterClockwise,
  ArrowRight,
  ArrowSquareOut,
  BookmarkSimple,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircleDots,
  CheckCircle,
  Clock,
  Compass,
  CurrencyDollar,
  Database,
  EyeSlash,
  Funnel,
  MagnifyingGlass,
  MapPin,
  PaperPlaneRight,
  ShareNetwork,
  SlidersHorizontal,
  Sparkle,
  UserCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { AuthDialog } from "./AuthDialog.jsx";
import {
  catalogMeta,
  categories,
  events,
  initialPreferences,
  nearbyAreas,
} from "./data.js";
import { askGuide } from "./lib/guide-client.js";
import { isSupabaseConfigured, supabase } from "./lib/supabase.js";

const guideProfileFields = [
  "age",
  "interests",
  "locations",
  "datePreference",
  "maxCost",
];

const guideProfileFieldLabels = {
  age: "Age",
  interests: "Interests",
  locations: "Location",
  datePreference: "Dates",
  maxCost: "Budget",
};

const initialGuideProfile = {
  age: null,
  interests: "",
  locations: "",
  datePreference: "",
  maxCost: null,
};

const initialGuideIntake = {
  complete: false,
  nextField: "age",
  step: 1,
  total: 5,
  suggestions: ["I'm 16", "I'm 18", "I'm 21 or older"],
};

const initialGuideMessages = [
  {
    id: "welcome",
    role: "assistant",
    summary:
      "Before I recommend anything, I’ll learn five details: your age, interests, preferred locations, date preference, and maximum cost.",
    eventIds: [],
    question: "First, how old are you?",
    providerLabel: "Profile setup",
    model: "step 1 of 5",
  },
];

const recommendationPrompts = [
  "What can I do this weekend?",
  "Which event is most hands-on?",
  "Confirmed age eligibility only",
];

const guideSuggestionFallbacks = {
  age: ["I'm 16", "I'm 18", "I'm 21 or older"],
  interests: ["AI and coding", "Maker projects", "Career opportunities"],
  locations: [
    "San Francisco",
    "Oakland or Berkeley",
    "Anywhere in the Bay Area",
  ],
  datePreference: ["This weekend", "The next two weeks", "Any upcoming date"],
  maxCost: ["Free only", "Up to $20", "Any budget"],
};

const initialGuideStatus = {
  phase: "intake",
  text: "Profile progress · step 1 of 5 · Age next",
};

function getLocalDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Los_Angeles",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

const todayDateKey = getLocalDateKey();

function buildCalendarDays(anchorDateKey) {
  const [year, month] = anchorDateKey.split("-").map(Number);
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(firstOfMonth);
  start.setUTCDate(1 - firstOfMonth.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const dateMonth = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    return {
      dateKey: `${date.getUTCFullYear()}-${String(dateMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      day: String(day),
      inMonth: dateMonth === month,
    };
  });
}

function shiftMonth(dateKey, amount) {
  const [year, month] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return date.toISOString().slice(0, 10);
}

function buildWeekendDates(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const today = new Date(Date.UTC(year, month - 1, day));
  const weekday = today.getUTCDay();
  const fridayDelta =
    weekday === 6 ? -1 : weekday === 0 ? -2 : 5 - weekday;
  const friday = new Date(today);
  friday.setUTCDate(today.getUTCDate() + fridayDelta);
  return Array.from({ length: 3 }, (_, index) => {
    const date = new Date(friday);
    date.setUTCDate(friday.getUTCDate() + index);
    const weekendDateKey = date.toISOString().slice(0, 10);
    return {
      dateKey: weekendDateKey,
      day: String(date.getUTCDate()),
      weekday: ["Fri", "Sat", "Sun"][index],
    };
  });
}

const weekendDates = buildWeekendDates(todayDateKey);

const verifiedEventCountsByDate = events.reduce((counts, event) => {
  if (
    event.verificationStatus !== "verified" ||
    Date.parse(event.endAt) <= Date.now()
  ) {
    return counts;
  }
  const dateKey = getLocalDateKey(new Date(event.startAt));
  counts[dateKey] = (counts[dateKey] || 0) + 1;
  return counts;
}, {});

const latestCatalogCheck = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
}).format(new Date(catalogMeta.generatedAt));

const currentCatalogEvents = events.filter(
  (event) => Date.parse(event.endAt) > Date.now(),
);
const catalogLastDateKey = currentCatalogEvents.length
  ? getLocalDateKey(new Date(currentCatalogEvents.at(-1).startAt))
  : todayDateKey;

const catalogDateRange = (() => {
  if (!currentCatalogEvents.length) return "No current event window";
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });
  return `${formatter.format(new Date(currentCatalogEvents[0].startAt))}–${formatter.format(
    new Date(currentCatalogEvents.at(-1).startAt),
  )}`;
})();

function getDateDetails(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return {
    weekday: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "UTC",
    }).format(date),
    day: String(day),
    monthYear: new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date),
    short: new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(date),
    long: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(date),
  };
}

function isGuideFieldCollected(profile, field) {
  if (field === "age") return Number.isFinite(profile.age);
  if (field === "maxCost") {
    return (
      Number.isFinite(profile.maxCost) ||
      profile.budgetFlexibility === "any"
    );
  }
  return typeof profile[field] === "string" && Boolean(profile[field].trim());
}

function getGuideProgress(profile, intake) {
  const total = Number.isFinite(intake?.total) ? intake.total : 5;
  const collected = guideProfileFields.filter((field) =>
    isGuideFieldCollected(profile, field),
  ).length;
  const complete = Boolean(intake?.complete);
  const nextField =
    intake?.nextField ||
    guideProfileFields.find((field) => !isGuideFieldCollected(profile, field)) ||
    null;
  const step = Number.isFinite(intake?.step)
    ? intake.step
    : Math.min(collected + 1, total);
  const nextLabel = nextField
    ? guideProfileFieldLabels[nextField] || nextField
    : null;

  return {
    complete,
    nextField,
    step,
    total,
    text: complete
      ? "Profile complete"
      : `Profile progress · step ${step} of ${total}${nextLabel ? ` · ${nextLabel} next` : ""}`,
  };
}

function getGuideProfileChips(profile) {
  const chips = [];
  if (Number.isFinite(profile.age)) chips.push(`Age · ${profile.age}`);
  if (profile.interests?.trim()) {
    chips.push(`Interests · ${profile.interests.trim()}`);
  }
  if (profile.locations?.trim()) {
    chips.push(`Location · ${profile.locations.trim()}`);
  }
  if (profile.datePreference?.trim()) {
    chips.push(`Dates · ${profile.datePreference.trim()}`);
  }
  if (profile.budgetFlexibility === "any") {
    chips.push("Budget · any");
  } else if (Number.isFinite(profile.maxCost)) {
    chips.push(`Budget · up to $${profile.maxCost}`);
  }
  return chips;
}

function getGuideSuggestions(intake) {
  if (intake?.complete) {
    return Array.isArray(intake.suggestions) && intake.suggestions.length
      ? intake.suggestions
      : recommendationPrompts;
  }
  if (Array.isArray(intake?.suggestions) && intake.suggestions.length) {
    return intake.suggestions;
  }
  return guideSuggestionFallbacks[intake?.nextField] || [];
}

function useStoredArray(key) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Local persistence is a convenience; the demo remains usable without it.
    }
  }, [key, value]);

  return [value, setValue];
}

function IconButton({ label, active = false, children, ...props }) {
  return (
    <button
      className={`icon-button${active ? " is-active" : ""}`}
      aria-label={label}
      title={label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

function StatusBadge({ event }) {
  const unknown = event.eligibility === "unknown";
  return (
    <span className={`eligibility-badge ${unknown ? "unknown" : "confirmed"}`}>
      {unknown ? (
        <WarningCircle size={15} weight="bold" aria-hidden="true" />
      ) : (
        <CheckCircle size={15} weight="fill" aria-hidden="true" />
      )}
      {event.eligibilityLabel}
    </span>
  );
}

function EventRow({
  event,
  rank,
  featured,
  saved,
  onOpen,
  onSave,
  onShare,
  onDismiss,
}) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`event-row${featured ? " is-featured" : ""}`}
      aria-labelledby={`event-${event.id}`}
    >
      <div className="event-rank" aria-hidden="true">
        {rank}
      </div>

      <button
        className="event-image-button"
        type="button"
        onClick={() => onOpen(event)}
        aria-label={`Open details for ${event.title}`}
      >
        <img src={event.image} alt={event.imageAlt} />
      </button>

      <div className="event-copy">
        <button
          className="event-title-button"
          type="button"
          onClick={() => onOpen(event)}
        >
          <h2 id={`event-${event.id}`}>{event.title}</h2>
        </button>

        <div className="event-meta" aria-label="Event logistics">
          <span>
            <CalendarBlank size={18} weight="regular" aria-hidden="true" />
            {event.dateLabel}
          </span>
          <span>
            <Clock size={18} weight="regular" aria-hidden="true" />
            {event.time.split("–")[0]}
          </span>
          <span>
            <MapPin size={18} weight="fill" aria-hidden="true" />
            {event.neighborhood}
          </span>
        </div>

        <div className="event-badges">
          <span className="plain-badge">{event.costLabel}</span>
          <span className="plain-badge">{event.audienceLabel}</span>
          <StatusBadge event={event} />
        </div>

        <div className="event-grounding">
          <span className="match-reason">
            {featured ? (
              <CheckCircle size={20} weight="fill" aria-hidden="true" />
            ) : (
              <Compass size={20} weight="regular" aria-hidden="true" />
            )}
            {event.matchLabel}
          </span>
          <a
            className="source-note"
            href={event.sourceHref}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${event.title} on ${event.sourcePlatform}`}
          >
            {event.source} · <em>{event.checked}</em>
            <ArrowSquareOut size={14} aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="event-actions" aria-label={`Actions for ${event.title}`}>
        <IconButton
          label={saved ? `Remove ${event.title} from saved` : `Save ${event.title}`}
          active={saved}
          onClick={() => onSave(event)}
        >
          <BookmarkSimple
            size={20}
            weight={saved ? "fill" : "regular"}
            aria-hidden="true"
          />
        </IconButton>
        <IconButton label={`Share ${event.title}`} onClick={() => onShare(event)}>
          <ShareNetwork size={20} aria-hidden="true" />
        </IconButton>
        <IconButton
          label={`Dismiss ${event.title}`}
          onClick={() => onDismiss(event)}
        >
          <EyeSlash size={20} aria-hidden="true" />
        </IconButton>
      </div>
    </motion.article>
  );
}

function EmptyState({
  savedOnly,
  selectedDateLabel,
  onShowAllDates,
  onReset,
  onOpenGuide,
}) {
  const hasDateFilter = Boolean(selectedDateLabel);
  return (
    <motion.div
      className="empty-state"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="status"
    >
      <div className="empty-icon">
        <MagnifyingGlass size={28} aria-hidden="true" />
      </div>
      <h2>
        {savedOnly
          ? hasDateFilter
            ? `No saved events on ${selectedDateLabel}`
            : "No saved events yet"
          : hasDateFilter
            ? `No verified match on ${selectedDateLabel}`
            : "No honest match found"}
      </h2>
      <p>
        {savedOnly
          ? hasDateFilter
            ? `None of your saved events fall on ${selectedDateLabel}.`
            : "Save an event and it will stay on this device for your demo."
          : hasDateFilter
            ? `The catalog has no event matching every active filter on ${selectedDateLabel}. Findr will not invent one to fill the gap.`
            : "The current filters conflict with the available catalog. Findr will not invent an event to fill the gap."}
      </p>
      <div className="empty-actions">
        {hasDateFilter ? (
          <>
            <button
              className="button primary"
              type="button"
              onClick={onShowAllDates}
            >
              Show all dates
            </button>
            <button className="button secondary" type="button" onClick={onReset}>
              Reset filters
            </button>
          </>
        ) : (
          <>
            <button className="button primary" type="button" onClick={onReset}>
              Reset filters
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={onOpenGuide}
            >
              Ask Findr what to relax
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

function GuideMessage({ message, onOpenEvent }) {
  if (message.role === "user") {
    return (
      <div className="guide-message user-message">
        <span className="message-avatar" aria-hidden="true">
          M
        </span>
        <div className="message-bubble">{message.text}</div>
      </div>
    );
  }

  const groundedEvents = (message.eventIds || [])
    .map((id) => events.find((event) => event.id === id))
    .filter(Boolean);

  return (
    <div className="guide-message assistant-message">
      <span className="message-avatar guide-avatar" aria-hidden="true">
        <Compass size={19} weight="bold" />
      </span>
      <div className={`assistant-card${message.noMatch ? " no-match" : ""}`}>
        <p>{message.summary}</p>

        {groundedEvents.length > 0 ? (
          <ol className="guide-event-list">
            {groundedEvents.map((event) => (
              <li key={event.id}>
                <button type="button" onClick={() => onOpenEvent(event)}>
                  <span className="guide-event-title">{event.shortTitle}</span>
                  <span>
                    {event.dateLabel} · {event.time.split("–")[0]} ·{" "}
                    {event.neighborhood}
                  </span>
                  <span
                    className={
                      event.eligibility === "unknown"
                        ? "guide-unknown"
                        : "guide-confirmed"
                    }
                  >
                    {event.eligibilityLabel}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : null}

        {message.caveat ? (
          <p className="guide-caveat">
            <WarningCircle size={17} weight="bold" aria-hidden="true" />
            {message.caveat}
          </p>
        ) : null}

        <p className="guide-question">{message.question}</p>
        {message.providerLabel ? (
          <span className="guide-provenance">
            {message.providerLabel}
            {message.model ? ` · ${message.model}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function GuidePanel({
  idPrefix,
  messages,
  input,
  setInput,
  loading,
  status,
  eventCount,
  profile,
  intake,
  onSubmit,
  onPrompt,
  onOpenEvent,
  onReset,
  onClose,
}) {
  const scrollRef = useRef(null);
  const progress = getGuideProgress(profile, intake);
  const profileChips = getGuideProfileChips(profile);
  const suggestions = getGuideSuggestions(intake);
  const nextFieldLabel = progress.nextField
    ? guideProfileFieldLabels[progress.nextField] || progress.nextField
    : null;
  const serviceStatusText =
    status.phase === "error"
      ? status.text
      : !progress.complete
        ? progress.text
        : status.phase === "idle"
          ? "AI answers are constrained to verified source records."
          : status.text;

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, loading]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  };

  return (
    <section className="guide-panel" aria-label="Findr guide">
      <header className="guide-header">
        <div>
          <div className="guide-title-row">
            <h2>Findr guide</h2>
            <Sparkle size={25} weight="fill" aria-hidden="true" />
          </div>
          <p>
            {progress.complete ? (
              <Database size={15} weight="bold" aria-hidden="true" />
            ) : (
              <UserCircle size={15} weight="bold" aria-hidden="true" />
            )}
            {progress.complete
              ? `${eventCount} verified source ${eventCount === 1 ? "record" : "records"}`
              : progress.text}
          </p>
        </div>
        {onClose ? (
          <IconButton label="Close Findr guide" onClick={onClose}>
            <X size={22} aria-hidden="true" />
          </IconButton>
        ) : null}
      </header>

      <div className="guide-scroll" ref={scrollRef}>
        {messages.map((message) => (
          <GuideMessage
            key={message.id}
            message={message}
            onOpenEvent={onOpenEvent}
          />
        ))}

        {loading ? (
          <div className="guide-message assistant-message" aria-live="polite">
            <span className="message-avatar guide-avatar" aria-hidden="true">
              <Compass size={19} weight="bold" />
            </span>
            <div className="assistant-card loading-card">
              <span />
              <span />
              <span />
              <em>{status.text}</em>
            </div>
          </div>
        ) : null}
      </div>

      {profileChips.length ? (
        <div className="guide-preferences" aria-label="Collected guide profile">
          {profileChips.map((chip) => (
            <span key={chip}>{chip}</span>
          ))}
        </div>
      ) : null}

      <div className="quick-prompts" aria-label="Suggested questions">
        {suggestions.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPrompt(prompt)}
            disabled={loading}
          >
            {prompt}
          </button>
        ))}
      </div>

      <form className="guide-form" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor={`${idPrefix}-guide-input`}>
          Ask Findr about these events
        </label>
        <input
          id={`${idPrefix}-guide-input`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={
            progress.complete
              ? "Compare, narrow, or ask why…"
              : `Tell Findr about ${nextFieldLabel?.toLowerCase() || "yourself"}…`
          }
          disabled={loading}
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={loading || !input.trim()}
        >
          <PaperPlaneRight size={22} weight="bold" aria-hidden="true" />
        </button>
      </form>

      <footer className="guide-footer">
        <button type="button" onClick={onReset}>
          <ArrowCounterClockwise size={16} aria-hidden="true" />
          Reset guide
        </button>
        <p className={`guide-service-status ${status.phase}`}>
          {serviceStatusText}
        </p>
      </footer>
    </section>
  );
}

function FilterDialog({
  open,
  onOpenChange,
  category,
  onCategoryChange,
  costFilter,
  onCostChange,
  eligibilityFilter,
  onEligibilityChange,
  resultCount,
  onReset,
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content filter-dialog">
          <div className="dialog-heading">
            <div>
              <span className="eyebrow">Discovery controls</span>
              <Dialog.Title>Filters</Dialog.Title>
              <Dialog.Description>
                Hard constraints are applied before interest ranking.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close filters">
                <X size={22} aria-hidden="true" />
              </IconButton>
            </Dialog.Close>
          </div>

          <fieldset>
            <legend>Category</legend>
            <div className="option-grid">
              {categories.map((item) => (
                <button
                  type="button"
                  key={item}
                  className={category === item ? "selected" : ""}
                  aria-pressed={category === item}
                  onClick={() => onCategoryChange(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Cost</legend>
            <div className="option-grid three">
              {["Any cost", "Free only", "Under $20"].map((item) => (
                <button
                  type="button"
                  key={item}
                  className={costFilter === item ? "selected" : ""}
                  aria-pressed={costFilter === item}
                  onClick={() => onCostChange(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Age eligibility</legend>
            <div className="option-grid two">
              {["Include unknown", "Confirmed only"].map((item) => (
                <button
                  type="button"
                  key={item}
                  className={eligibilityFilter === item ? "selected" : ""}
                  aria-pressed={eligibilityFilter === item}
                  onClick={() => onEligibilityChange(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <p className="field-help">
              “Include unknown” never means approved. Unknown policies stay
              visibly labeled.
            </p>
          </fieldset>

          <div className="dialog-actions">
            <button className="button ghost" type="button" onClick={onReset}>
              Reset
            </button>
            <Dialog.Close asChild>
              <button className="button primary" type="button">
                Show {resultCount} {resultCount === 1 ? "event" : "events"}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EventDialog({
  event,
  open,
  onOpenChange,
  saved,
  onSave,
  onShare,
  onContinue,
}) {
  if (!event) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content event-dialog">
          <Dialog.Close asChild>
            <IconButton label="Close event details">
              <X size={22} aria-hidden="true" />
            </IconButton>
          </Dialog.Close>

          <div className="event-dialog-hero">
            <img src={event.image} alt={event.imageAlt} />
            <div className="event-dialog-title">
              <span className="eyebrow">{event.categories.join(" · ")}</span>
              <Dialog.Title>{event.title}</Dialog.Title>
              <Dialog.Description>{event.description}</Dialog.Description>
            </div>
          </div>

          <div className="event-dialog-body">
            <div className="detail-logistics">
              <div>
                <CalendarBlank size={21} aria-hidden="true" />
                <span>
                  <strong>{event.dateLong}</strong>
                  {event.time}
                </span>
              </div>
              <div>
                <MapPin size={21} weight="fill" aria-hidden="true" />
                <span>
                  <strong>{event.venue}</strong>
                  {event.address}
                </span>
              </div>
              <div>
                <CurrencyDollar size={21} aria-hidden="true" />
                <span>
                  <strong>{event.costLabel}</strong>
                  Registration {event.registration.toLowerCase()}
                </span>
              </div>
            </div>

            <section className="fit-section">
              <div className="fit-heading">
                <span>
                  <Compass size={20} weight="bold" aria-hidden="true" />
                  Why this fits
                </span>
                <StatusBadge event={event} />
              </div>
              <p>{event.matchReason}</p>
              <small>{event.confidence}</small>
            </section>

            {event.unknowns.length ? (
              <section className="unknown-section">
                <h3>
                  <WarningCircle size={20} weight="bold" aria-hidden="true" />
                  Confirm before registering
                </h3>
                <ul>
                  {event.unknowns.map((unknown) => (
                    <li key={unknown}>{unknown}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="source-strip">
              <Database size={20} weight="bold" aria-hidden="true" />
              <span>
                <strong>{event.source}</strong>
                {event.checked} · Canonical event page
              </span>
              <a
                href={event.sourceHref}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${event.title} on ${event.sourcePlatform}`}
              >
                Open on {event.sourcePlatform}
                <ArrowSquareOut size={16} aria-hidden="true" />
              </a>
            </div>

            <div className="event-dialog-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => onSave(event)}
              >
                <BookmarkSimple
                  size={19}
                  weight={saved ? "fill" : "regular"}
                  aria-hidden="true"
                />
                {saved ? "Saved" : "Save event"}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => onShare(event)}
              >
                <ShareNetwork size={19} aria-hidden="true" />
                Share
              </button>
              <button
                className="button primary"
                type="button"
                onClick={() => onContinue(event)}
              >
                View source
                <ArrowRight size={19} weight="bold" aria-hidden="true" />
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ExternalNoticeDialog({ event, open, onOpenChange }) {
  if (!event) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content external-dialog">
          <div className="external-icon">
            <ArrowRight size={25} weight="bold" aria-hidden="true" />
          </div>
          <Dialog.Title>You’re leaving Findr</Dialog.Title>
          <Dialog.Description>
            Organizer details are the authority for eligibility, availability,
            and registration. Findr will open this event’s canonical{" "}
            {event.sourcePlatform} page.
          </Dialog.Description>
          <div className="external-event">
            <strong>{event.title}</strong>
            <span>{event.source}</span>
          </div>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button className="button secondary" type="button">
                Stay in Findr
              </button>
            </Dialog.Close>
            <a
              className="button primary"
              href={event.sourceHref}
              target="_blank"
              rel="noreferrer"
              onClick={() => onOpenChange(false)}
            >
              Open on {event.sourcePlatform}
              <ArrowRight size={19} weight="bold" aria-hidden="true" />
            </a>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DateRail({
  origin,
  eventCount,
  sourceCount,
  checkedLabel,
  selectedDate,
  onDateChange,
  onOriginChange,
  onDataStatus,
}) {
  const featuredDate = getDateDetails(selectedDate || todayDateKey);
  const [calendarMonth, setCalendarMonth] = useState(
    `${(selectedDate || todayDateKey).slice(0, 7)}-01`,
  );
  useEffect(() => {
    if (selectedDate) {
      setCalendarMonth(`${selectedDate.slice(0, 7)}-01`);
    }
  }, [selectedDate]);
  const calendarDays = buildCalendarDays(calendarMonth);
  const calendarMonthLabel = getDateDetails(calendarMonth).monthYear;
  const canViewPreviousMonth =
    calendarMonth.slice(0, 7) > todayDateKey.slice(0, 7);
  const canViewNextMonth =
    calendarMonth.slice(0, 7) < catalogLastDateKey.slice(0, 7);

  return (
    <aside className="date-rail" aria-label="Date and nearby areas">
      <div className="today-block">
        <span>{featuredDate.weekday}</span>
        <strong>{featuredDate.day}</strong>
        <em>{featuredDate.monthYear}</em>
      </div>

      <div
        className="mini-calendar"
        aria-label={`${calendarMonthLabel} calendar`}
      >
        <div className="calendar-month-nav">
          <button
            type="button"
            disabled={!canViewPreviousMonth}
            aria-label="Show previous month"
            onClick={() =>
              setCalendarMonth((current) => shiftMonth(current, -1))
            }
          >
            <CaretLeft size={14} weight="bold" aria-hidden="true" />
          </button>
          <span>{calendarMonthLabel}</span>
          <button
            type="button"
            disabled={!canViewNextMonth}
            aria-label="Show next month"
            onClick={() =>
              setCalendarMonth((current) => shiftMonth(current, 1))
            }
          >
            <CaretRight size={14} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <div className="weekdays" aria-hidden="true">
          {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
            <span key={`${day}-${index}`}>{day}</span>
          ))}
        </div>
        <div className="calendar-days">
          {calendarDays.map((calendarDay) => {
            if (!calendarDay.inMonth) {
              return (
                <span
                  className="outside-month"
                  key={calendarDay.dateKey}
                  aria-hidden="true"
                >
                  {calendarDay.day}
                </span>
              );
            }

            const isPast = calendarDay.dateKey < todayDateKey;
            const isToday = calendarDay.dateKey === todayDateKey;
            const isSelected = calendarDay.dateKey === selectedDate;
            const eventCountForDate =
              verifiedEventCountsByDate[calendarDay.dateKey] || 0;
            const dateLabel = getDateDetails(calendarDay.dateKey).long;
            const eventLabel = eventCountForDate
              ? `${eventCountForDate} verified ${eventCountForDate === 1 ? "event" : "events"}`
              : "no verified events";

            return (
              <button
                type="button"
                key={calendarDay.dateKey}
                className={[
                  isToday ? "today" : "",
                  isSelected ? "selected" : "",
                  eventCountForDate ? "has-events" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={isPast}
                aria-current={isToday ? "date" : undefined}
                aria-pressed={isSelected}
                aria-label={`${dateLabel}, ${eventLabel}${isPast ? ", date has passed" : ""}`}
                onClick={() => onDateChange(calendarDay.dateKey)}
              >
                {calendarDay.day}
              </button>
            );
          })}
        </div>
      </div>

      <section className="rail-section weekend-list">
        <h2>This weekend</h2>
        {weekendDates.map((weekendDate) => {
          const isSelected = weekendDate.dateKey === selectedDate;
          const isPast = weekendDate.dateKey < todayDateKey;
          const eventCountForDate =
            verifiedEventCountsByDate[weekendDate.dateKey] || 0;
          return (
            <button
              type="button"
              key={weekendDate.dateKey}
              className={[
                isSelected ? "selected" : "",
                eventCountForDate ? "has-events" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={isPast}
              aria-pressed={isSelected}
              aria-label={`${getDateDetails(weekendDate.dateKey).long}, ${
                eventCountForDate
                  ? `${eventCountForDate} verified ${eventCountForDate === 1 ? "event" : "events"}`
                  : "no verified events"
              }${isPast ? ", date has passed" : ""}`}
              onClick={() => onDateChange(weekendDate.dateKey)}
            >
              <strong>{weekendDate.day}</strong>
              <span>{weekendDate.weekday}</span>
            </button>
          );
        })}
      </section>

      <section className="rail-section nearby-list">
        <h2>Nearby areas</h2>
        {nearbyAreas.map((area) => (
          <button
            type="button"
            key={area.name}
            className={origin === area.name ? "selected" : ""}
            aria-pressed={origin === area.name}
            onClick={() => onOriginChange(area.name)}
          >
            <span>{area.name}</span>
            <small>{area.travel === "origin" ? "You" : area.travel}</small>
          </button>
        ))}
      </section>

      <button className="data-status" type="button" onClick={onDataStatus}>
        <CheckCircle size={20} weight="fill" aria-hidden="true" />
        <span>
          <strong>Catalog current</strong>
          {eventCount} real events · {sourceCount} sources · {checkedLabel}
        </span>
        <CaretDown size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}

export function App() {
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [costFilter, setCostFilter] = useState("Any cost");
  const [eligibilityFilter, setEligibilityFilter] =
    useState("Include unknown");
  const [selectedDate, setSelectedDate] = useState(null);
  const [sortBy, setSortBy] = useState("best");
  const [displayLimit, setDisplayLimit] = useState(18);
  const [origin, setOrigin] = useState(initialPreferences.origin);
  const [savedOnly, setSavedOnly] = useState(false);
  const [savedIds, setSavedIds] = useStoredArray("findr:saved");
  const [dismissedIds, setDismissedIds] = useStoredArray("findr:dismissed");
  const [lastDismissed, setLastDismissed] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideDesktopOpen, setGuideDesktopOpen] = useState(true);
  const [activeEvent, setActiveEvent] = useState(null);
  const [externalEvent, setExternalEvent] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(isSupabaseConfigured);
  const [guideMessages, setGuideMessages] = useState(initialGuideMessages);
  const [guideProfile, setGuideProfile] = useState(initialGuideProfile);
  const [guideIntake, setGuideIntake] = useState(initialGuideIntake);
  const [guideInput, setGuideInput] = useState("");
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideStatus, setGuideStatus] = useState(initialGuideStatus);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const guideAbortRef = useRef(null);

  const discoveryPreferences = {
    ...initialPreferences,
    origin,
  };
  const selectedDateDetails = selectedDate
    ? getDateDetails(selectedDate)
    : null;

  const showToast = (message) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(""), 3600);
  };

  const toggleSelectedDate = (dateKey) => {
    setSelectedDate((current) => (current === dateKey ? null : dateKey));
  };

  useEffect(
    () => () => {
      window.clearTimeout(toastTimer.current);
      guideAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const hashId = window.location.hash.replace("#event=", "");
    const eventFromHash = events.find((event) => event.id === hashId);
    if (eventFromHash) setActiveEvent(eventFromHash);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setSessionLoading(false);
      return undefined;
    }

    let active = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        console.error("Unable to restore Supabase session", error);
      }
      setSession(data.session);
      setSessionLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setSessionLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const visibleEvents = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const now = Date.now();
    const filtered = events.filter((event) => {
      const searchable = [
        event.title,
        event.neighborhood,
        event.venue,
        event.description,
        event.source,
        ...event.tags,
        ...event.categories,
      ]
        .join(" ")
        .toLowerCase();
      const matchesSearch = !query || searchable.includes(query);
      const matchesCategory =
        category === "All" || event.categories.includes(category);
      const matchesCost =
        costFilter === "Any cost" ||
        (costFilter === "Free only" && event.cost === 0) ||
        (costFilter === "Under $20" &&
          Number.isFinite(event.cost) &&
          event.cost <= 20);
      const matchesEligibility =
        eligibilityFilter === "Include unknown" ||
        event.eligibility === "confirmed";
      const matchesDate =
        !selectedDate ||
        getLocalDateKey(new Date(event.startAt)) === selectedDate;
      const matchesSaved = !savedOnly || savedIds.includes(event.id);
      const notDismissed = !dismissedIds.includes(event.id);
      const isCurrent = Date.parse(event.endAt) > now;

      return (
        isCurrent &&
        matchesSearch &&
        matchesCategory &&
        matchesCost &&
        matchesEligibility &&
        matchesDate &&
        matchesSaved &&
        notDismissed
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === "price") {
        if (a.cost === null && b.cost === null) return 0;
        if (a.cost === null) return 1;
        if (b.cost === null) return -1;
        return a.cost - b.cost;
      }
      if (sortBy === "eligibility") {
        return a.eligibility === b.eligibility
          ? 0
          : a.eligibility === "confirmed"
            ? -1
            : 1;
      }
      return events.findIndex((item) => item.id === a.id) -
        events.findIndex((item) => item.id === b.id);
    });
  }, [
    category,
    costFilter,
    dismissedIds,
    eligibilityFilter,
    savedIds,
    savedOnly,
    searchQuery,
    selectedDate,
    sortBy,
  ]);
  const displayedEvents = visibleEvents.slice(0, displayLimit);

  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("q", searchQuery);
    if (category !== "All") params.set("category", category);
    if (costFilter !== "Any cost") params.set("cost", costFilter);
    if (eligibilityFilter !== "Include unknown") {
      params.set("age", "confirmed");
    }
    if (selectedDate) params.set("date", selectedDate);
    const next = params.size ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState(null, "", next);
  }, [category, costFilter, eligibilityFilter, searchQuery, selectedDate]);

  useEffect(() => {
    setDisplayLimit(18);
  }, [
    category,
    costFilter,
    eligibilityFilter,
    savedOnly,
    searchQuery,
    selectedDate,
    sortBy,
  ]);

  const resetFilters = () => {
    setSearchDraft("");
    setSearchQuery("");
    setCategory("All");
    setCostFilter("Any cost");
    setEligibilityFilter("Include unknown");
    setSelectedDate(null);
    setSavedOnly(false);
    setDismissedIds([]);
    showToast("Discovery filters reset");
  };

  const submitSearch = (event) => {
    event.preventDefault();
    setSearchQuery(searchDraft.trim());
  };

  const toggleSaved = (event) => {
    const isSaved = savedIds.includes(event.id);
    setSavedIds((current) =>
      isSaved
        ? current.filter((id) => id !== event.id)
        : [...current, event.id],
    );
    showToast(isSaved ? "Removed from saved" : `${event.shortTitle} saved`);
  };

  const shareEvent = async (event) => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#event=${event.id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast("Share link copied");
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = shareUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      textArea.remove();
      showToast("Share link copied");
    }
  };

  const dismissEvent = (event) => {
    setDismissedIds((current) =>
      current.includes(event.id) ? current : [...current, event.id],
    );
    setLastDismissed(event);
    showToast(`${event.shortTitle} dismissed`);
  };

  const undoDismiss = () => {
    if (!lastDismissed) return;
    setDismissedIds((current) =>
      current.filter((id) => id !== lastDismissed.id),
    );
    showToast(`${lastDismissed.shortTitle} restored`);
    setLastDismissed(null);
  };

  const openEvent = (event) => {
    setActiveEvent(event);
    window.history.replaceState(null, "", `#event=${event.id}`);
  };

  const closeEvent = (open) => {
    if (!open) {
      setActiveEvent(null);
      const next =
        window.location.pathname +
        window.location.search;
      window.history.replaceState(null, "", next);
    }
  };

  const continueToSource = (event) => {
    setActiveEvent(null);
    setExternalEvent(event);
  };

  const submitGuide = async (prompt) => {
    if (guideLoading) return;
    const submittingIntake = !guideIntake.complete;
    const currentProgress = getGuideProgress(guideProfile, guideIntake);
    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: prompt,
    };
    setGuideMessages((current) => [...current, userMessage]);
    setGuideInput("");
    setGuideLoading(true);
    setGuideStatus(
      submittingIntake
        ? {
            phase: "intake",
            text: `Saving ${(
              guideProfileFieldLabels[currentProgress.nextField] || "profile"
            ).toLowerCase()}…`,
          }
        : { phase: "retrieving", text: "Searching verified events…" },
    );

    const controller = new AbortController();
    guideAbortRef.current = controller;
    const history = guideMessages
      .slice(-6)
      .map((message) => ({
        role: message.role,
        content:
          message.role === "user"
            ? message.text
            : [message.summary, message.caveat, message.question]
                .filter(Boolean)
                .join(" "),
        ...(message.role === "assistant" &&
        Array.isArray(message.eventIds) &&
        message.eventIds.length
          ? { eventIds: message.eventIds.slice(0, 4) }
          : {}),
      }));

    try {
      const result = await askGuide(
        {
          query: prompt,
          history,
          profile: guideProfile,
          visibleEventIds: visibleEvents.map((event) => event.id),
        },
        {
          signal: controller.signal,
          onStatus: (status) => {
            if (status.type === "retrieval") {
              setGuideStatus({
                phase: "retrieving",
                text: `Grounded in ${status.events.length} verified ${status.events.length === 1 ? "event" : "events"}`,
              });
            } else if (status.type === "attempt") {
              setGuideStatus({
                phase: "connecting",
                text: `Trying ${status.providerLabel}…`,
              });
            } else if (status.type === "alive") {
              setGuideStatus({
                phase: "responding",
                text: `${status.providerLabel} is responding…`,
              });
            } else if (status.type === "fallback") {
              setGuideStatus({
                phase: "connecting",
                text: `${status.providerLabel} did not finish; trying the next model…`,
              });
            } else if (
              submittingIntake &&
              status.type === "answer" &&
              status.provider === "intake"
            ) {
              setGuideStatus({
                phase: "intake",
                text: currentProgress.text,
              });
            }
          },
        },
      );
      const returnedProfile =
        result.profile || result.doneMetadata?.profile || null;
      const returnedIntake =
        result.intake || result.doneMetadata?.intake || null;
      const nextProfile = returnedProfile
        ? { ...guideProfile, ...returnedProfile }
        : guideProfile;
      const nextIntake = returnedIntake
        ? {
            ...guideIntake,
            ...returnedIntake,
            suggestions: Array.isArray(returnedIntake.suggestions)
              ? returnedIntake.suggestions
              : [],
          }
        : guideIntake;
      const reply = {
        ...result.message,
        id: `assistant-${Date.now()}`,
        provider: result.provider,
        providerLabel: result.providerLabel,
        model: result.model,
      };
      setGuideProfile(nextProfile);
      setGuideIntake(nextIntake);
      setGuideMessages((current) => [...current, reply]);
      if (nextIntake.complete) {
        setGuideStatus({
          phase: result.provider === "local" ? "degraded" : "ready",
          text:
            result.provider === "local"
              ? "Live providers were unavailable · verified retrieval used"
              : `${result.providerLabel} · ${result.model}`,
        });
      } else {
        setGuideStatus({
          phase: "intake",
          text: getGuideProgress(nextProfile, nextIntake).text,
        });
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        setGuideMessages((current) => [
          ...current,
          {
            id: `assistant-error-${Date.now()}`,
            role: "assistant",
            summary: "The live concierge could not reach its local API.",
            eventIds: [],
            caveat:
              "Event browsing and source links still work. This AI endpoint runs only in the local development demo until a production server function is deployed.",
            question: "Try again after the local API reconnects?",
            noMatch: true,
            providerLabel: "Connection error",
          },
        ]);
        setGuideStatus({
          phase: "error",
          text: "Live guide unavailable",
        });
      }
    } finally {
      if (guideAbortRef.current === controller) {
        guideAbortRef.current = null;
      }
      setGuideLoading(false);
    }
  };

  const resetGuide = () => {
    guideAbortRef.current?.abort();
    guideAbortRef.current = null;
    setGuideLoading(false);
    setGuideMessages(initialGuideMessages);
    setGuideProfile({ ...initialGuideProfile });
    setGuideIntake({
      ...initialGuideIntake,
      suggestions: [...initialGuideIntake.suggestions],
    });
    setGuideInput("");
    setGuideStatus(initialGuideStatus);
    showToast("Findr guide reset");
  };

  return (
    <MotionConfig reducedMotion="user">
      <a className="skip-link" href="#discover-results">
        Skip to event results
      </a>

      <div
        className={`app-shell${guideDesktopOpen ? "" : " guide-collapsed"}`}
      >
        <header className="topbar">
          <button className="wordmark" type="button" onClick={resetFilters}>
            Findr
          </button>

          <button
            className="location-control"
            type="button"
            onClick={() => showToast(`Using ${origin} as your travel origin`)}
          >
            <MapPin size={18} weight="fill" aria-hidden="true" />
            SF + Bay Area
            <CaretDown size={15} aria-hidden="true" />
          </button>

          <form className="topbar-search" onSubmit={submitSearch}>
            <label className="sr-only" htmlFor="topbar-search">
              Search events, topics, or places
            </label>
            <MagnifyingGlass size={20} aria-hidden="true" />
            <input
              id="topbar-search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search events, topics, or places"
            />
          </form>

          <button
            className={`saved-control${savedOnly ? " is-active" : ""}`}
            type="button"
            onClick={() => setSavedOnly((current) => !current)}
            aria-pressed={savedOnly}
          >
            <BookmarkSimple
              size={20}
              weight={savedOnly ? "fill" : "regular"}
              aria-hidden="true"
            />
            Saved
            {savedIds.length ? <span>{savedIds.length}</span> : null}
          </button>

          <button
            className={`guide-toggle-control${guideDesktopOpen ? " is-active" : ""}`}
            type="button"
            onClick={() => setGuideDesktopOpen((current) => !current)}
            aria-pressed={guideDesktopOpen}
            aria-label={
              guideDesktopOpen ? "Close Findr guide" : "Open Findr guide"
            }
          >
            <ChatCircleDots size={20} weight="bold" aria-hidden="true" />
            Guide
          </button>

          <button
            className="profile-button"
            type="button"
            onClick={() => setAuthOpen(true)}
            aria-label={
              session ? `Open account for ${session.user.email}` : "Sign in"
            }
            title={session ? session.user.email : "Sign in or create account"}
          >
            {session?.user?.email ? (
              session.user.email.slice(0, 1).toUpperCase()
            ) : (
              <UserCircle size={23} weight="bold" aria-hidden="true" />
            )}
          </button>
        </header>

        <DateRail
          origin={origin}
          eventCount={events.length}
          sourceCount={catalogMeta.sources.length}
          checkedLabel={latestCatalogCheck}
          selectedDate={selectedDate}
          onDateChange={toggleSelectedDate}
          onOriginChange={(nextOrigin) => {
            setOrigin(nextOrigin);
            showToast(`Travel origin changed to ${nextOrigin}`);
          }}
          onDataStatus={() =>
            showToast(
              `${events.length} real events from ${catalogMeta.sources.length} current source feeds · synced ${latestCatalogCheck}`,
            )
          }
        />

        <main className="discover">
          <div className="discover-inner">
            <section className="discover-intro" aria-labelledby="discover-title">
              <span className="mobile-date">
                {selectedDateDetails
                  ? `${selectedDateDetails.short} · San Francisco`
                  : `${getDateDetails(todayDateKey).short} · Bay Area`}
              </span>
              <h1 id="discover-title">
                Your weekend, with the
                <br />
                guesswork removed.
              </h1>

              <form className="hero-search" onSubmit={submitSearch}>
                <label className="sr-only" htmlFor="hero-search">
                  What are you in the mood to learn or do?
                </label>
                <MagnifyingGlass size={31} aria-hidden="true" />
                <input
                  id="hero-search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="What are you in the mood to learn or do?"
                />
                <button type="submit" aria-label="Search the event catalog">
                  <ArrowRight size={27} weight="bold" aria-hidden="true" />
                </button>
              </form>

              <div className="category-bar" aria-label="Event categories">
                {categories.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={category === item ? "selected" : ""}
                    aria-pressed={category === item}
                    onClick={() => setCategory(item)}
                  >
                    {item}
                  </button>
                ))}
                <button
                  className="filter-trigger"
                  type="button"
                  onClick={() => setFilterOpen(true)}
                >
                  <SlidersHorizontal size={19} aria-hidden="true" />
                  Filters
                </button>
              </div>
            </section>

            <section
              className="results-section"
              id="discover-results"
              aria-labelledby="results-heading"
            >
              <div className="results-toolbar">
                <div>
                  <h2 id="results-heading">
                    {visibleEvents.length}{" "}
                    {visibleEvents.length === 1
                      ? "verified event"
                      : "verified events"}{" "}
                    {selectedDateDetails
                      ? `on ${selectedDateDetails.long}`
                      : "coming up"}
                  </h2>
                  <span>
                    {selectedDateDetails
                      ? `Synced ${latestCatalogCheck} · Date filter: ${selectedDateDetails.long}`
                      : `Synced ${latestCatalogCheck} · ${catalogDateRange}`}
                  </span>
                </div>

                <label className="sort-control">
                  <span>Sorted by</span>
                  <select
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value)}
                    aria-label="Sort events"
                  >
                    <option value="best">best fit</option>
                    <option value="price">lowest cost</option>
                    <option value="eligibility">eligibility confidence</option>
                  </select>
                  <CaretDown size={15} aria-hidden="true" />
                </label>
              </div>

              <div className="active-constraints" aria-label="Active filters">
                <button
                  className={
                    selectedDate ? "date-constraint-selected" : undefined
                  }
                  type="button"
                  aria-label={
                    selectedDateDetails
                      ? `Clear date filter for ${selectedDateDetails.long}`
                      : "Open date and event filters"
                  }
                  onClick={() =>
                    selectedDate
                      ? setSelectedDate(null)
                      : setFilterOpen(true)
                  }
                >
                  <CalendarBlank size={16} aria-hidden="true" />
                  {selectedDateDetails
                    ? selectedDateDetails.short
                    : discoveryPreferences.date}
                  {selectedDate ? <X size={14} aria-hidden="true" /> : null}
                </button>
                <button type="button" onClick={() => setFilterOpen(true)}>
                  <CurrencyDollar size={16} aria-hidden="true" />
                  {costFilter}
                </button>
                <button type="button" onClick={() => setFilterOpen(true)}>
                  <Funnel size={16} aria-hidden="true" />
                  {eligibilityFilter}
                </button>
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setSearchDraft("");
                    }}
                  >
                    “{searchQuery}”
                    <X size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              <div className="event-list" aria-live="polite">
                <AnimatePresence initial={false} mode="popLayout">
                  {displayedEvents.map((event, index) => (
                    <EventRow
                      key={event.id}
                      event={event}
                      rank={index + 1}
                      featured={index === 0}
                      saved={savedIds.includes(event.id)}
                      onOpen={openEvent}
                      onSave={toggleSaved}
                      onShare={shareEvent}
                      onDismiss={dismissEvent}
                    />
                  ))}
                </AnimatePresence>

                {!visibleEvents.length ? (
                  <EmptyState
                    savedOnly={savedOnly}
                    selectedDateLabel={selectedDateDetails?.long}
                    onShowAllDates={() => setSelectedDate(null)}
                    onReset={resetFilters}
                    onOpenGuide={() => setGuideOpen(true)}
                  />
                ) : null}
              </div>

              {displayedEvents.length < visibleEvents.length ? (
                <button
                  className="load-more-events"
                  type="button"
                  onClick={() =>
                    setDisplayLimit((current) =>
                      Math.min(current + 18, visibleEvents.length),
                    )
                  }
                >
                  Show 18 more
                  <span>
                    {displayedEvents.length} of {visibleEvents.length}
                  </span>
                </button>
              ) : null}

              <div className="results-footnote">
                <Database size={17} weight="bold" aria-hidden="true" />
                <p>
                  Every result is a real source record with a direct organizer
                  link. The committed snapshot refreshes from official open
                  data and RSS feeds; recheck the organizer before attending.
                </p>
                {dismissedIds.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDismissedIds([]);
                      showToast("Dismissed events restored");
                    }}
                  >
                    Restore dismissed
                  </button>
                ) : null}
              </div>
            </section>
          </div>

          <button
            className="mobile-guide-button"
            type="button"
            onClick={() => setGuideOpen(true)}
          >
            <Sparkle size={20} weight="fill" aria-hidden="true" />
            Ask Findr
            <span>{events.length}</span>
          </button>
        </main>

        {guideDesktopOpen ? (
          <aside className="guide-desktop">
            <GuidePanel
              idPrefix="desktop"
              messages={guideMessages}
              input={guideInput}
              setInput={setGuideInput}
              loading={guideLoading}
              status={guideStatus}
              eventCount={events.length}
              profile={guideProfile}
              intake={guideIntake}
              onSubmit={submitGuide}
              onPrompt={submitGuide}
              onOpenEvent={openEvent}
              onReset={resetGuide}
              onClose={() => setGuideDesktopOpen(false)}
            />
          </aside>
        ) : null}
      </div>

      <FilterDialog
        open={filterOpen}
        onOpenChange={setFilterOpen}
        category={category}
        onCategoryChange={setCategory}
        costFilter={costFilter}
        onCostChange={setCostFilter}
        eligibilityFilter={eligibilityFilter}
        onEligibilityChange={setEligibilityFilter}
        resultCount={visibleEvents.length}
        onReset={resetFilters}
      />

      <Dialog.Root open={guideOpen} onOpenChange={setGuideOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay guide-overlay" />
          <Dialog.Content className="mobile-guide-dialog">
            <Dialog.Title className="sr-only">Findr guide</Dialog.Title>
            <Dialog.Description className="sr-only">
              Ask grounded questions about the visible event catalog.
            </Dialog.Description>
            <GuidePanel
              idPrefix="mobile"
              messages={guideMessages}
              input={guideInput}
              setInput={setGuideInput}
              loading={guideLoading}
              status={guideStatus}
              eventCount={events.length}
              profile={guideProfile}
              intake={guideIntake}
              onSubmit={submitGuide}
              onPrompt={submitGuide}
              onOpenEvent={(event) => {
                setGuideOpen(false);
                openEvent(event);
              }}
              onReset={resetGuide}
              onClose={() => setGuideOpen(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <EventDialog
        event={activeEvent}
        open={Boolean(activeEvent)}
        onOpenChange={closeEvent}
        saved={activeEvent ? savedIds.includes(activeEvent.id) : false}
        onSave={toggleSaved}
        onShare={shareEvent}
        onContinue={continueToSource}
      />

      <ExternalNoticeDialog
        event={externalEvent}
        open={Boolean(externalEvent)}
        onOpenChange={(open) => {
          if (!open) setExternalEvent(null);
        }}
      />

      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        session={session}
        sessionLoading={sessionLoading}
        onAccountDeleted={() => {
          setSavedIds([]);
          setDismissedIds([]);
          setLastDismissed(null);
          showToast("Account deleted");
        }}
      />

      <AnimatePresence>
        {toast ? (
          <motion.div
            className="toast"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
          >
            <CheckCircle size={20} weight="fill" aria-hidden="true" />
            <span>{toast}</span>
            {lastDismissed && toast.includes("dismissed") ? (
              <button type="button" onClick={undoDismiss}>
                Undo
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  );
}
