import assert from "node:assert/strict";
import test from "node:test";
import { retrieveEvents } from "../server/catalog.mjs";
import {
  deduplicateEvents,
  selectDiverseEvents,
} from "../server/events/pipeline.mjs";
import { validateEvent } from "../server/events/schema.mjs";
import {
  BIBLIOCOMMONS_LIBRARIES,
  parseBibliocommonsRss,
} from "../server/events/sources/bibliocommons.mjs";
import {
  parseLumaDiscoverIcal,
  verifyLumaDiscoverEvents,
} from "../server/events/sources/luma-discover.mjs";
import { normalizeOur415Record } from "../server/events/sources/our415.mjs";
import { parseSfRecParkRss } from "../server/events/sources/sf-rec-park.mjs";

const checkedAt = "2026-07-26T18:30:00.000Z";

function our415Record(overrides = {}) {
  return {
    id: "sfpl-art-lab-2026-08-10",
    event_name: "Neighborhood Art Lab",
    event_start_date: "2026-08-10T00:00:00.000",
    event_end_date: "2026-08-10T00:00:00.000",
    start_time: "18:00:00",
    end_time: "19:30:00",
    event_description:
      "<p>A free, hands-on art workshop for the neighborhood.</p>",
    events_category: "Arts & Crafts",
    age_group_eligibility_tags: "Teens; Young Adults",
    language_eligibility_tags: "English",
    org_name: "SF Public Library",
    site_location_name: "Mission Bay Branch Library",
    site_address: "960 4th St, San Francisco, CA 94158",
    analysis_neighborhood: "Mission Bay",
    latitude: "37.7755",
    longitude: "-122.3937",
    fee: "false",
    admission_price: "Free",
    more_info:
      "http://sfpl.org/events/2026/08/10/neighborhood-art-lab#registration",
    event_photo: {
      url: "http://sfpl.org/images/neighborhood-art-lab.jpg",
    },
    data_as_of: "2026-07-26T16:00:00.000",
    ...overrides,
  };
}

function normalizedOur415Event(overrides = {}) {
  const event = normalizeOur415Record(our415Record(), { checkedAt });
  assert.ok(event);
  return { ...event, ...overrides };
}

test("Our415 normalization preserves a direct organizer link and provenance while leaving eligibility unknown", () => {
  const event = normalizedOur415Event();

  assert.equal(
    event.sourceHref,
    "https://sfpl.org/events/2026/08/10/neighborhood-art-lab",
  );
  assert.equal(event.sourceId, "sfpl-art-lab-2026-08-10");
  assert.equal(event.sourcePlatform, "SFPL");
  assert.equal(event.source, "DataSF · SF Public Library");
  assert.equal(event.sourceDataset, "DataSF Our415 · daily open data");
  assert.equal(event.sourceType, "open-data");
  assert.equal(event.sourceCheckedAt, checkedAt);
  assert.equal(event.sourceDataAt, "2026-07-26T16:00:00.000");
  assert.equal(event.verificationStatus, "verified");
  assert.deepEqual(event.ageTags, ["Teens", "Young Adults"]);
  assert.equal(event.eligibility, "unknown");
  assert.match(event.eligibilityLabel, /not independently confirmed/i);
  assert.match(event.unknowns.join(" "), /discovery hints/i);
});

test("SF Recreation and Parks RSS parsing preserves schedule, location, cost, and source provenance", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss xmlns:calendarEvent="urn:calendar">
      <channel>
        <lastBuildDate>Sat, 25 Jul 2026 16:00:00 GMT</lastBuildDate>
        <item>
          <title>Live Music at Golden Gate Bandshell</title>
          <link>http://www.sfrecpark.org/Calendar.aspx?EID=9012&amp;month=8</link>
          <calendarEvent:EventDates>Sat, 08 Aug 2026 00:00:00 GMT</calendarEvent:EventDates>
          <calendarEvent:EventTimes>6:00 PM - 8:30 PM</calendarEvent:EventTimes>
          <calendarEvent:Location>Music Concourse, San Francisco, CA</calendarEvent:Location>
          <description><![CDATA[Location: Music Concourse, San Francisco, CA<br/>Description: Free community music concert.]]></description>
          <enclosure url="http://www.sfrecpark.org/images/bandshell.jpg" />
        </item>
      </channel>
    </rss>`;

  const events = parseSfRecParkRss(xml, { checkedAt });
  assert.equal(events.length, 1);

  const [event] = events;
  assert.equal(event.id, "sfrecpark-9012");
  assert.equal(event.sourceId, "9012");
  assert.equal(event.sourcePlatform, "SF Rec Park");
  assert.equal(event.sourceDataset, "SF Rec Park · official calendar RSS");
  assert.equal(event.sourceType, "rss");
  assert.equal(event.sourceCheckedAt, checkedAt);
  assert.equal(event.sourceDataAt, "Sat, 25 Jul 2026 16:00:00 GMT");
  assert.equal(event.sourceHref, "https://www.sfrecpark.org/Calendar.aspx?EID=9012&month=8");
  assert.equal(event.startAt, "2026-08-09T01:00:00.000Z");
  assert.equal(event.endAt, "2026-08-09T03:30:00.000Z");
  assert.equal(event.venue, "Golden Gate Bandshell");
  assert.equal(event.address, "Music Concourse, San Francisco, CA");
  assert.equal(event.cost, 0);
  assert.equal(event.costLabel, "Free");
  assert.equal(event.eligibility, "unknown");
  assert.ok(event.categories.includes("Creative"));
  assert.ok(event.categories.includes("Community"));
});

test("BiblioCommons rejects cancelled and full records while preserving structured venue and registration data", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss xmlns:bc="urn:bibliocommons">
      <channel>
        <lastBuildDate>Sun, 26 Jul 2026 17:00:00 GMT</lastBuildDate>
        <item>
          <title>Teen Art Lab</title>
          <link>http://paloalto.bibliocommons.com/events/teen-art-lab-123</link>
          <description><![CDATA[Free hands-on art and design workshop.]]></description>
          <bc:start_date>2026-08-04T18:00:00-07:00</bc:start_date>
          <bc:end_date>2026-08-04T19:30:00-07:00</bc:end_date>
          <bc:is_cancelled>false</bc:is_cancelled>
          <bc:is_virtual>false</bc:is_virtual>
          <category>Teens</category>
          <category>Art</category>
          <bc:registration_info>
            <bc:is_required>true</bc:is_required>
            <bc:is_full>false</bc:is_full>
          </bc:registration_info>
          <bc:location>
            <bc:name>Mitchell Park Library</bc:name>
            <bc:number>3700</bc:number>
            <bc:street>Middlefield Rd</bc:street>
            <bc:city>Palo Alto</bc:city>
            <bc:state>CA</bc:state>
            <bc:zip>94303</bc:zip>
            <bc:latitude>37.4218</bc:latitude>
            <bc:longitude>-122.1129</bc:longitude>
          </bc:location>
        </item>
        <item>
          <title>Cancelled Community Workshop</title>
          <link>https://paloalto.bibliocommons.com/events/cancelled-456</link>
          <description>Cancelled event.</description>
          <bc:start_date>2026-08-05T18:00:00-07:00</bc:start_date>
          <bc:end_date>2026-08-05T19:00:00-07:00</bc:end_date>
          <bc:is_cancelled>true</bc:is_cancelled>
          <bc:registration_info>
            <bc:is_required>false</bc:is_required>
            <bc:is_full>false</bc:is_full>
          </bc:registration_info>
        </item>
        <item>
          <title>Full Coding Club</title>
          <link>https://paloalto.bibliocommons.com/events/full-789</link>
          <description>Free coding club.</description>
          <bc:start_date>2026-08-06T18:00:00-07:00</bc:start_date>
          <bc:end_date>2026-08-06T19:00:00-07:00</bc:end_date>
          <bc:is_cancelled>false</bc:is_cancelled>
          <bc:registration_info>
            <bc:is_required>true</bc:is_required>
            <bc:is_full>true</bc:is_full>
          </bc:registration_info>
        </item>
      </channel>
    </rss>`;

  const events = parseBibliocommonsRss(
    xml,
    BIBLIOCOMMONS_LIBRARIES[0],
    { checkedAt },
  );

  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.id, "bibliocommons-paloalto-teen-art-lab-123");
  assert.equal(event.title, "Teen Art Lab");
  assert.equal(event.sourceHref, "https://paloalto.bibliocommons.com/events/teen-art-lab-123");
  assert.equal(event.venue, "Mitchell Park Library");
  assert.equal(event.address, "3700 Middlefield Rd, Palo Alto, CA, 94303");
  assert.equal(event.neighborhood, "Palo Alto");
  assert.equal(event.latitude, 37.4218);
  assert.equal(event.longitude, -122.1129);
  assert.equal(event.registration, "Registration required");
  assert.equal(event.registrationStatus, "required");
  assert.equal(event.sourceId, "teen-art-lab-123");
  assert.equal(event.sourceType, "rss");
  assert.ok(event.tags.includes("Teens"));
  assert.equal(event.eligibility, "unknown");
});

test("Luma city iCal accepts tentative events, rejects cancelled records, and preserves canonical discovery provenance", () => {
  const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20260808T010000Z
DTEND:20260808T040000Z
DTSTAMP:20260726T180000Z
ORGANIZER;CN="Bay Area Builders":MAILTO:calendar-invite@lu.ma
UID:evt-ai-build-night@events.lu.ma
SUMMARY:AI Founder Build Night
DESCRIPTION:Get up-to-date information at: https://luma.com/ai-build-night\\n\\nAddress:\\nBuilder House\\nSan Francisco\\, CA\\nUnited States\\n\\nFounders and developers will build agentic AI products and share demos.
LOCATION:Builder House\\, San Francisco\\, CA
GEO:37.781;-122.405
STATUS:TENTATIVE
END:VEVENT
BEGIN:VEVENT
DTSTART:20260809T010000Z
DTEND:20260809T030000Z
UID:evt-cancelled@events.lu.ma
SUMMARY:Cancelled AI Meetup
DESCRIPTION:Get up-to-date information at: https://luma.com/cancelled-ai
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;

  const events = parseLumaDiscoverIcal(ical, { checkedAt });
  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.id, "luma-discover-evt-ai-build-night");
  assert.equal(event.sourceHref, "https://luma.com/ai-build-night");
  assert.equal(event.sourceDataset, "Luma San Francisco · official city iCal");
  assert.equal(event.sourceType, "ical");
  assert.equal(event.sourcePlatform, "Luma");
  assert.equal(event.sourceCheckedAt, checkedAt);
  assert.equal(event.startAt, "2026-08-08T01:00:00.000Z");
  assert.equal(event.endAt, "2026-08-08T04:00:00.000Z");
  assert.equal(event.venue, "Builder House, San Francisco, CA");
  assert.equal(event.cost, null);
  assert.equal(event.costLabel, "Cost not published");
  assert.equal(event.eligibility, "unknown");
  assert.ok(event.categories.includes("AI & Startups"));
  assert.ok(event.tags.includes("AI"));
  assert.ok(event.tags.includes("Startups"));
  assert.ok(event.tags.includes("Demos"));
});

test("Luma structured recheck enriches available events and excludes sold-out events", async () => {
  const base = parseLumaDiscoverIcal(
    `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20260808T010000Z
DTEND:20260808T040000Z
DTSTAMP:20260726T180000Z
ORGANIZER;CN="Bay Area Builders":MAILTO:calendar-invite@lu.ma
UID:evt-ai-build-night@events.lu.ma
SUMMARY:AI Founder Build Night
DESCRIPTION:Get up-to-date information at: https://luma.com/ai-build-night\\n\\nFounders and developers will build AI products.
LOCATION:https://luma.com/event/evt-ai-build-night
GEO:37.781;-122.405
STATUS:TENTATIVE
END:VEVENT
BEGIN:VEVENT
DTSTART:20260809T010000Z
DTEND:20260809T040000Z
DTSTAMP:20260726T180000Z
ORGANIZER;CN="Demo Community":MAILTO:calendar-invite@lu.ma
UID:evt-sold-out-demo@events.lu.ma
SUMMARY:AI Demo Night
DESCRIPTION:Get up-to-date information at: https://luma.com/sold-out-demo\\n\\nAn AI demo night.
LOCATION:San Francisco
STATUS:TENTATIVE
END:VEVENT
END:VCALENDAR`,
    { checkedAt },
  );
  const structured = {
    "https://luma.com/ai-build-night": {
      "@context": "https://schema.org",
      "@type": "Event",
      name: "AI Founder Build Night",
      eventStatus: "https://schema.org/EventScheduled",
      startDate: "2026-08-07T18:00:00.000-07:00",
      endDate: "2026-08-07T21:00:00.000-07:00",
      description:
        "Founders and developers will build agentic AI products and share demos.",
      location: {
        "@type": "Place",
        name: "Builder House",
        address: {
          "@type": "PostalAddress",
          streetAddress: "123 Market St",
          addressLocality: "San Francisco",
          addressRegion: "CA",
          postalCode: "94105",
        },
        geo: {
          "@type": "GeoCoordinates",
          latitude: 37.781,
          longitude: -122.405,
        },
      },
      organizer: [{ "@type": "Organization", name: "Bay Area Builders" }],
      offers: [{
        "@type": "Offer",
        price: 0,
        availability: "https://schema.org/InStock",
      }],
    },
    "https://luma.com/sold-out-demo": {
      "@context": "https://schema.org",
      "@type": "Event",
      name: "AI Demo Night",
      eventStatus: "https://schema.org/EventScheduled",
      startDate: "2026-08-08T18:00:00.000-07:00",
      endDate: "2026-08-08T21:00:00.000-07:00",
      offers: [{
        "@type": "Offer",
        price: 0,
        availability: "https://schema.org/SoldOut",
      }],
    },
  };
  const fetchImpl = async (url) => ({
    ok: true,
    text: async () =>
      `<script type="application/ld+json">${JSON.stringify(structured[String(url)])}</script>`,
  });

  const verified = await verifyLumaDiscoverEvents(base, {
    checkedAt,
    fetchImpl,
    concurrency: 2,
  });
  assert.equal(verified.length, 1);
  const [event] = verified;
  assert.equal(event.id, "luma-discover-evt-ai-build-night");
  assert.equal(event.venue, "Builder House");
  assert.equal(event.address, "123 Market St, San Francisco, CA, 94105");
  assert.equal(event.neighborhood, "San Francisco");
  assert.equal(event.cost, 0);
  assert.equal(event.costLabel, "Free");
  assert.equal(event.registrationStatus, "open");
  assert.match(event.confidence, /rechecked/i);
});

test("event schema rejects records explicitly marked as mock data", () => {
  const event = normalizedOur415Event({
    sourceType: "mock",
    sourceDataset: "Findr mock fixtures",
  });

  assert.throws(() => validateEvent(event), /mock/i);
});

test("event schema rejects non-HTTPS source URLs", () => {
  const event = normalizedOur415Event({
    sourceHref: "http://example.test/events/not-secure",
  });

  assert.throws(() => validateEvent(event), /HTTPS source URL/i);
});

test("event schema accepts an explicitly unknown cost without coercing it to free", () => {
  const unknownCost = normalizedOur415Event({
    cost: null,
    costLabel: "Cost not published",
    unknowns: [
      "The source feed does not publish an exact price.",
    ],
  });

  assert.equal(validateEvent(unknownCost), unknownCost);
  assert.equal(unknownCost.cost, null);
  assert.equal(unknownCost.costLabel, "Cost not published");
  assert.match(unknownCost.unknowns.join(" "), /does not publish an exact price/i);
});

test("deduplication collapses canonical URL, source ID, and title-time-venue duplicates", () => {
  const original = normalizedOur415Event();
  const sameUrl = normalizedOur415Event({
    id: "same-url",
    sourceId: "different-source-id",
    sourceHref: `${original.sourceHref}?utm_source=newsletter#details`,
  });
  const sameSourceId = normalizedOur415Event({
    id: "same-source-id",
    sourceHref: "https://sfpl.org/events/alternate-path",
  });
  const sameFingerprint = normalizedOur415Event({
    id: "same-fingerprint",
    sourceId: "external-duplicate",
    sourcePlatform: "External calendar",
    sourceHref: "https://events.example.org/neighborhood-art-lab",
  });
  const distinct = normalizedOur415Event({
    id: "distinct-event",
    sourceId: "distinct-event",
    title: "Outdoor Film Night",
    shortTitle: "Outdoor Film Night",
    startAt: "2026-08-12T02:00:00.000Z",
    endAt: "2026-08-12T04:00:00.000Z",
    venue: "Mission Dolores Park",
    sourceHref: "https://events.example.org/outdoor-film-night",
  });

  const deduplicated = deduplicateEvents([
    original,
    sameUrl,
    sameSourceId,
    sameFingerprint,
    distinct,
  ]);

  assert.deepEqual(
    deduplicated.map((event) => event.id),
    [original.id, distinct.id],
  );
});

test("diverse selection respects day, venue, title, and organizer caps before filling the limit", () => {
  const first = normalizedOur415Event({
    id: "first",
    sourceId: "first",
    title: "Community Maker Lab",
    shortTitle: "Community Maker Lab",
    startAt: "2026-08-01T16:00:00.000Z",
    endAt: "2026-08-01T17:00:00.000Z",
    venue: "Main Library",
    source: "Organizer A",
    sourceHref: "https://events.example.org/first",
  });
  const cappedDuplicate = {
    ...first,
    id: "capped-duplicate",
    sourceId: "capped-duplicate",
    title: "Community Maker Lab: Afternoon",
    shortTitle: "Maker Lab: Afternoon",
    startAt: "2026-08-01T18:00:00.000Z",
    endAt: "2026-08-01T19:00:00.000Z",
    sourceHref: "https://events.example.org/capped-duplicate",
  };
  const second = {
    ...first,
    id: "second",
    sourceId: "second",
    title: "Park Concert",
    shortTitle: "Park Concert",
    startAt: "2026-08-02T16:00:00.000Z",
    endAt: "2026-08-02T17:00:00.000Z",
    venue: "Golden Gate Park",
    source: "Organizer B",
    sourceHref: "https://events.example.org/second",
  };
  const third = {
    ...first,
    id: "third",
    sourceId: "third",
    title: "Teen Career Workshop",
    shortTitle: "Teen Career Workshop",
    startAt: "2026-08-03T16:00:00.000Z",
    endAt: "2026-08-03T17:00:00.000Z",
    venue: "Mission Branch",
    source: "Organizer C",
    sourceHref: "https://events.example.org/third",
  };

  const selected = selectDiverseEvents(
    [first, cappedDuplicate, second, third],
    {
      limit: 3,
      maxPerDay: 1,
      maxPerVenue: 1,
      maxPerTitle: 1,
      maxPerOrganizer: 1,
    },
  );

  assert.deepEqual(
    selected.map((event) => event.id),
    ["first", "second", "third"],
  );
  assert.equal(new Set(selected.map((event) => event.startAt.slice(0, 10))).size, 3);
  assert.equal(new Set(selected.map((event) => event.venue)).size, 3);
  assert.equal(new Set(selected.map((event) => event.source)).size, 3);
});

test("an explicitly empty visible event ID set produces no retrieval results", () => {
  const results = retrieveEvents({
    query: "Show me upcoming events",
    visibleEventIds: [],
    now: new Date("2026-07-23T12:00:00-07:00"),
  });

  assert.deepEqual(results, []);
});
