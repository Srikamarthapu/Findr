import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  ArrowCounterClockwise,
  ArrowRight,
  BookmarkSimple,
  CalendarBlank,
  CaretDown,
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
import { categories, events, initialPreferences, nearbyAreas } from "./data.js";
import { isSupabaseConfigured, supabase } from "./lib/supabase.js";

const initialGuideMessages = [
  {
    id: "welcome-user",
    role: "user",
    text: "I’m 16, in the Mission, free this weekend, and can spend up to $20.",
  },
  {
    id: "welcome-assistant",
    role: "assistant",
    summary: "Here are 3 weekend events that match your request.",
    eventIds: events.map((event) => event.id),
    question: "Confirmed eligibility or strongest AI focus?",
  },
];

const quickPrompts = [
  "Confirmed eligibility only",
  "Compare robotics and AI",
  "Show me a no-match example",
];

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

function getGuideReply(rawPrompt) {
  const prompt = rawPrompt.toLowerCase();

  if (
    prompt.includes("no-match") ||
    prompt.includes("no match") ||
    prompt.includes("outdoor") ||
    prompt.includes("concert tonight") ||
    prompt.includes("berkeley only")
  ) {
    return {
      role: "assistant",
      summary: "I couldn’t find a catalog event that satisfies every constraint.",
      eventIds: [],
      caveat:
        "The limiting constraint is the event type or location. I kept your age, weekend, and $20 budget rules intact.",
      question: "Relax location to SF + Bay Area or keep the current constraints?",
      noMatch: true,
    };
  }

  if (prompt.includes("compare")) {
    return {
      role: "assistant",
      summary:
        "The robotics lab is the safer practical choice; the AI workshop is the closer topic match.",
      eventIds: ["evt-robotics-0725", "evt-ai-0726"],
      caveat:
        "Only the robotics lab publishes a confirmed teen age range. The AI workshop’s eligibility is unknown.",
      question: "Prioritize confirmed eligibility or direct AI experience?",
    };
  }

  if (
    prompt.includes("confirmed") ||
    prompt.includes("teen") ||
    prompt.includes("age")
  ) {
    return {
      role: "assistant",
      summary: "One current catalog event has confirmed teen eligibility.",
      eventIds: ["evt-robotics-0725"],
      caveat:
        "The other two remain visible in Browse, but I excluded them here because their age policies are not published.",
      question: "Keep confirmed eligibility as a hard constraint?",
    };
  }

  if (prompt.includes("ai") || prompt.includes("artificial intelligence")) {
    return {
      role: "assistant",
      summary: "Two catalog events have a direct AI or robotics learning fit.",
      eventIds: ["evt-ai-0726", "evt-robotics-0725"],
      caveat:
        "The AI workshop is under budget, but its minimum age is not listed.",
      question: "Want the confirmed teen option first, or the strongest AI match?",
    };
  }

  if (prompt.includes("free") || prompt.includes("cheapest")) {
    return {
      role: "assistant",
      summary: "One event is confirmed free and fits the rest of your profile.",
      eventIds: ["evt-robotics-0725"],
      question: "Should I keep cost at $0 or include events up to $20?",
    };
  }

  return {
    role: "assistant",
    summary:
      "I checked your request against the three current records in this demo catalog.",
    eventIds: events.map((event) => event.id),
    caveat:
      "I did not infer missing age details; two records still require organizer confirmation.",
    question: "What matters most next: topic, eligibility, or travel time?",
  };
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
          <span className="plain-badge">Beginner</span>
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
          <span className="source-note">
            {event.source} · <em>{event.checked}</em>
          </span>
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

function EmptyState({ savedOnly, onReset, onOpenGuide }) {
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
      <h2>{savedOnly ? "No saved events yet" : "No honest match found"}</h2>
      <p>
        {savedOnly
          ? "Save an event and it will stay on this device for your demo."
          : "The current filters conflict with the available catalog. Findr will not invent an event to fill the gap."}
      </p>
      <div className="empty-actions">
        <button className="button primary" type="button" onClick={onReset}>
          Reset filters
        </button>
        <button className="button secondary" type="button" onClick={onOpenGuide}>
          Ask Findr what to relax
        </button>
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

  const groundedEvents = message.eventIds
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
  preferences,
  onSubmit,
  onPrompt,
  onOpenEvent,
  onReset,
  onClose,
}) {
  const scrollRef = useRef(null);

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
            <Database size={15} weight="bold" aria-hidden="true" />
            3 catalog matches
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
              <em>Checking the catalog…</em>
            </div>
          </div>
        ) : null}
      </div>

      <div className="guide-preferences" aria-label="Active preferences">
        <span>{preferences.origin} area</span>
        <span>{preferences.date}</span>
        <span>Up to ${preferences.maxCost}</span>
        <span>{preferences.level}</span>
      </div>

      <div className="quick-prompts" aria-label="Suggested questions">
        {quickPrompts.map((prompt) => (
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
          placeholder="Compare, narrow, or ask why…"
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
        <p>Demo responses use only the 3 visible catalog records.</p>
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
                {event.checked} · Demo catalog record {event.id}
              </span>
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
            and registration. This demo opens the source collection rather than
            a live event checkout.
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
              Continue to source
              <ArrowRight size={19} weight="bold" aria-hidden="true" />
            </a>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DateRail({ origin, onOriginChange, onDataStatus }) {
  const calendarDays = [
    "28",
    "29",
    "30",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "11",
    "12",
    "13",
    "14",
    "15",
    "16",
    "17",
    "18",
    "19",
    "20",
    "21",
    "22",
    "23",
    "24",
    "25",
    "26",
    "27",
    "28",
    "29",
    "30",
    "31",
    "1",
  ];

  return (
    <aside className="date-rail" aria-label="Date and nearby areas">
      <div className="today-block">
        <span>Thursday</span>
        <strong>23</strong>
        <em>July 2026</em>
      </div>

      <div className="mini-calendar" aria-label="July 2026 calendar">
        <div className="weekdays" aria-hidden="true">
          {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
            <span key={`${day}-${index}`}>{day}</span>
          ))}
        </div>
        <div className="calendar-days">
          {calendarDays.map((day, index) => (
            <span
              key={`${day}-${index}`}
              className={day === "23" && index === 25 ? "today" : ""}
            >
              {day}
            </span>
          ))}
        </div>
      </div>

      <section className="rail-section weekend-list">
        <h2>This weekend</h2>
        <div>
          <strong>24</strong>
          <span>Fri</span>
        </div>
        <div>
          <strong>25</strong>
          <span>Sat</span>
        </div>
        <div>
          <strong>26</strong>
          <span>Sun</span>
        </div>
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
          3 records checked today
        </span>
        <CaretDown size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}

export function App() {
  const reduceMotion = useReducedMotion();
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [costFilter, setCostFilter] = useState("Under $20");
  const [eligibilityFilter, setEligibilityFilter] =
    useState("Include unknown");
  const [sortBy, setSortBy] = useState("best");
  const [origin, setOrigin] = useState(initialPreferences.origin);
  const [savedOnly, setSavedOnly] = useState(false);
  const [savedIds, setSavedIds] = useStoredArray("findr:saved");
  const [dismissedIds, setDismissedIds] = useStoredArray("findr:dismissed");
  const [lastDismissed, setLastDismissed] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [activeEvent, setActiveEvent] = useState(null);
  const [externalEvent, setExternalEvent] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(isSupabaseConfigured);
  const [guideMessages, setGuideMessages] = useState(initialGuideMessages);
  const [guideInput, setGuideInput] = useState("");
  const [guideLoading, setGuideLoading] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const responseTimer = useRef(null);

  const preferences = {
    ...initialPreferences,
    origin,
  };

  const showToast = (message) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(""), 3600);
  };

  useEffect(
    () => () => {
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(responseTimer.current);
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
        (costFilter === "Under $20" && event.cost <= 20);
      const matchesEligibility =
        eligibilityFilter === "Include unknown" ||
        event.eligibility === "confirmed";
      const matchesSaved = !savedOnly || savedIds.includes(event.id);
      const notDismissed = !dismissedIds.includes(event.id);

      return (
        matchesSearch &&
        matchesCategory &&
        matchesCost &&
        matchesEligibility &&
        matchesSaved &&
        notDismissed
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === "price") return a.cost - b.cost;
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
    sortBy,
  ]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("q", searchQuery);
    if (category !== "All") params.set("category", category);
    if (costFilter !== "Under $20") params.set("cost", costFilter);
    if (eligibilityFilter !== "Include unknown") {
      params.set("age", "confirmed");
    }
    const next = params.size ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState(null, "", next);
  }, [category, costFilter, eligibilityFilter, searchQuery]);

  const resetFilters = () => {
    setSearchDraft("");
    setSearchQuery("");
    setCategory("All");
    setCostFilter("Under $20");
    setEligibilityFilter("Include unknown");
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

  const submitGuide = (prompt) => {
    if (guideLoading) return;
    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: prompt,
    };
    setGuideMessages((current) => [...current, userMessage]);
    setGuideInput("");
    setGuideLoading(true);
    responseTimer.current = window.setTimeout(() => {
      const reply = {
        ...getGuideReply(prompt),
        id: `assistant-${Date.now()}`,
      };
      setGuideMessages((current) => [...current, reply]);
      setGuideLoading(false);
    }, reduceMotion ? 120 : 650);
  };

  const resetGuide = () => {
    window.clearTimeout(responseTimer.current);
    setGuideLoading(false);
    setGuideMessages(initialGuideMessages);
    setGuideInput("");
    showToast("Findr guide reset");
  };

  return (
    <MotionConfig reducedMotion="user">
      <a className="skip-link" href="#discover-results">
        Skip to event results
      </a>

      <div className="app-shell">
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
          onOriginChange={(nextOrigin) => {
            setOrigin(nextOrigin);
            showToast(`Travel origin changed to ${nextOrigin}`);
          }}
          onDataStatus={() =>
            showToast("All 3 demo records were checked on Jul 23, 2026")
          }
        />

        <main className="discover">
          <div className="discover-inner">
            <section className="discover-intro" aria-labelledby="discover-title">
              <span className="mobile-date">Thu · Jul 23 · San Francisco</span>
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
                    {visibleEvents.length === 1 ? "match" : "matches"} for this
                    weekend
                  </h2>
                  <span>Sat, Jul 25–Sun, Jul 26, 2026</span>
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
                <button type="button" onClick={() => setFilterOpen(true)}>
                  <CalendarBlank size={16} aria-hidden="true" />
                  This weekend
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
                  {visibleEvents.map((event, index) => (
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
                    onReset={resetFilters}
                    onOpenGuide={() => setGuideOpen(true)}
                  />
                ) : null}
              </div>

              <div className="results-footnote">
                <Database size={17} weight="bold" aria-hidden="true" />
                <p>
                  Results come from a cached demo catalog. Unknown details stay
                  unknown until a source confirms them.
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
            <span>3</span>
          </button>
        </main>

        <aside className="guide-desktop">
          <GuidePanel
            idPrefix="desktop"
            messages={guideMessages}
            input={guideInput}
            setInput={setGuideInput}
            loading={guideLoading}
            preferences={preferences}
            onSubmit={submitGuide}
            onPrompt={submitGuide}
            onOpenEvent={openEvent}
            onReset={resetGuide}
          />
        </aside>
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
              preferences={preferences}
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
