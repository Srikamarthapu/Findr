import { cleanText, decodeEntities } from "./normalize.mjs";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function xmlItems(xml) {
  return [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(
    (match) => match[1],
  );
}

export function xmlTag(xml, tagName) {
  const tag = escapeRegExp(tagName);
  const match = String(xml).match(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  if (!match) return "";
  return decodeEntities(
    match[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1").trim(),
  );
}

export function xmlTags(xml, tagName) {
  const tag = escapeRegExp(tagName);
  return [
    ...String(xml).matchAll(
      new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"),
    ),
  ]
    .map((match) =>
      decodeEntities(
        match[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1").trim(),
      ),
    )
    .filter(Boolean);
}

export function xmlBlock(xml, tagName) {
  const tag = escapeRegExp(tagName);
  const match = String(xml).match(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match?.[1] || "";
}

export function xmlAttribute(xml, tagName, attributeName) {
  const tag = escapeRegExp(tagName);
  const attribute = escapeRegExp(attributeName);
  const match = String(xml).match(
    new RegExp(
      `<${tag}\\b[^>]*\\s${attribute}=(?:"([^"]*)"|'([^']*)')[^>]*>`,
      "i",
    ),
  );
  return decodeEntities(match?.[1] || match?.[2] || "");
}

export function cleanXmlText(value) {
  return cleanText(
    String(value).replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1"),
  );
}
