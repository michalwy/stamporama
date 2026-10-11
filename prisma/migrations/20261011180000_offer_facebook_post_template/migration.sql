-- An offer's own Facebook post template (#1780): null follows its group's template for the offer's
-- type, as every offer did until now, so nothing existing changes. Text, even empty, is the offer's
-- own — a custom template may be blank, and is then a lot with no text, named on the card.
ALTER TABLE "offer" ADD COLUMN "facebookPostTemplate" TEXT;
