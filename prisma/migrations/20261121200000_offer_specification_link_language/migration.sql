-- #2605: an offer's specification can be shared in a chosen language, and a link keeps the language
-- it was made in. A free ISO 639-1 code, as `platform.titleLanguage` is. Null on a link made before
-- this: it stays in the offer's own language — its platform's listing language, else the
-- collection's — as it always was.
ALTER TABLE "offer_specification_share_token" ADD COLUMN "language" TEXT;
