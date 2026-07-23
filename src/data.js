export const events = [
  {
    id: "evt-robotics-0725",
    title: "Beginner Robotics Build Lab",
    shortTitle: "Robotics Build Lab",
    dateLabel: "Sat, Jul 25",
    dateLong: "Saturday, July 25, 2026",
    time: "1:00 PM–3:30 PM",
    neighborhood: "Mission Bay",
    venue: "Pier 70 Learning Lab",
    address: "20th Street at Illinois Street, San Francisco",
    categories: ["Tech", "Community"],
    tags: ["Robotics", "Beginner", "Hands-on"],
    cost: 0,
    costLabel: "Free",
    eligibility: "confirmed",
    eligibilityLabel: "Ages 14–18",
    format: "In person",
    registration: "Open",
    source: "SF Youth Calendar",
    checked: "checked 12m ago",
    sourceHref: "https://sf.gov/events",
    image: "/assets/events/robotics-lab.png",
    imageAlt:
      "A small student-built wheeled robot on a makerspace workbench.",
    matchLabel: "Strong practical fit",
    matchReason:
      "Free, explicitly open to ages 14–18, beginner-friendly, and reachable from the Mission.",
    description:
      "Build and test a small rover with volunteer mentors. The session starts with a short electronics primer, then moves into guided assembly and a friendly obstacle-course test.",
    confidence: "Confirmed from organizer details",
    unknowns: [],
  },
  {
    id: "evt-ai-0726",
    title: "Intro to Applied AI Workshop",
    shortTitle: "Applied AI Workshop",
    dateLabel: "Sun, Jul 26",
    dateLong: "Sunday, July 26, 2026",
    time: "11:00 AM–1:00 PM",
    neighborhood: "SoMa",
    venue: "Howard Street Learning Commons",
    address: "Howard Street, San Francisco",
    categories: ["Tech", "Career"],
    tags: ["AI", "Beginner", "Workshop"],
    cost: 15,
    costLabel: "$15",
    eligibility: "unknown",
    eligibilityLabel: "Eligibility unknown",
    format: "In person",
    registration: "Open",
    source: "SF Tech Events",
    checked: "checked 18m ago",
    sourceHref:
      "https://www.eventbrite.com/d/ca--san-francisco/technology--events/",
    image: "/assets/events/ai-workshop.png",
    imageAlt:
      "Young people taking part in an introductory technology workshop.",
    matchLabel: "Under your $20 budget",
    matchReason:
      "Direct AI interest match, beginner-level, on Sunday morning, and within the stated budget.",
    description:
      "A practical introduction to prompt design, model limits, and small AI projects. Participants work through examples in pairs and leave with a starter project outline.",
    confidence: "Schedule and price confirmed",
    unknowns: ["The organizer does not publish a minimum age."],
  },
  {
    id: "evt-hardware-0726",
    title: "Community Hardware Demo Night",
    shortTitle: "Hardware Demo Night",
    dateLabel: "Sun, Jul 26",
    dateLong: "Sunday, July 26, 2026",
    time: "6:30 PM–8:30 PM",
    neighborhood: "Dogpatch",
    venue: "Minnesota Street Makers Hall",
    address: "Minnesota Street, San Francisco",
    categories: ["Tech", "Creative", "Community"],
    tags: ["Hardware", "Making", "Demo night"],
    cost: 10,
    costLabel: "$10 suggested",
    eligibility: "unknown",
    eligibilityLabel: "Eligibility unknown",
    format: "In person",
    registration: "Open",
    source: "SF Makers Calendar",
    checked: "checked 15m ago",
    sourceHref:
      "https://www.meetup.com/find/us--ca--san-francisco/technology/",
    image: "/assets/events/hardware-night.png",
    imageAlt:
      "Electronics tools and a circuit board on a community workshop table.",
    matchLabel: "Hands-on community option",
    matchReason:
      "Under budget, close to the Mission, and relevant to building hardware with other makers.",
    description:
      "Local makers share short demos of works in progress, from tiny sensors to custom keyboards. Newcomers can join a guided soldering table before the demos begin.",
    confidence: "Schedule and suggested cost confirmed",
    unknowns: [
      "The organizer does not publish a minimum age.",
      "Evening networking may skew toward adults.",
    ],
  },
];

export const categories = ["All", "Tech", "Career", "Creative", "Community"];

export const nearbyAreas = [
  { name: "Mission", travel: "origin" },
  { name: "SoMa", travel: "18 min" },
  { name: "Dogpatch", travel: "24 min" },
  { name: "Oakland", travel: "38 min" },
  { name: "Berkeley", travel: "45+ min" },
];

export const initialPreferences = {
  age: 16,
  origin: "Mission",
  date: "This weekend",
  maxCost: 20,
  level: "Beginner",
  includeUnknownEligibility: true,
};
