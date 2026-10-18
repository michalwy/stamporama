import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COMMON_CURRENCIES, CURRENCY_SYMBOLS, currencySymbol } from "../../src/lib/currencies";
import {
  isKnownTemplateToken,
  resolveTemplateToken,
  splitTemplateToken,
  templateTokens,
  writtenAmount,
} from "../../src/lib/template-amount";

// How a template placeholder writes an amount (#2028): the currency's symbol by default, its code or
// nothing when the placeholder's parameter asks, the number always as generated text writes it (#1787).

describe("CURRENCY_SYMBOLS (#2028)", () => {
  it("gives every currency the app offers a symbol and a place", () => {
    for (const code of COMMON_CURRENCIES) {
      assert.ok(CURRENCY_SYMBOLS[code].symbol.trim() !== "", `${code} has a symbol`);
    }
  });

  it("holds the issue's table", () => {
    assert.deepEqual(CURRENCY_SYMBOLS.PLN, { symbol: "zł", before: false });
    assert.deepEqual(CURRENCY_SYMBOLS.USD, { symbol: "$", before: true });
    assert.deepEqual(CURRENCY_SYMBOLS.EUR, { symbol: "€", before: false });
    assert.deepEqual(CURRENCY_SYMBOLS.GBP, { symbol: "£", before: true });
    assert.deepEqual(CURRENCY_SYMBOLS.CHF, { symbol: "Fr.", before: true });
    assert.deepEqual(CURRENCY_SYMBOLS.CZK, { symbol: "Kč", before: false });
    for (const code of ["DKK", "SEK", "NOK"] as const) {
      assert.deepEqual(CURRENCY_SYMBOLS[code], { symbol: "kr", before: false });
    }
  });

  it("knows no symbol for a code outside the table", () => {
    assert.equal(currencySymbol("XYZ"), null);
    assert.equal(currencySymbol("toString"), null);
  });
});

describe("writtenAmount (#2028)", () => {
  it("writes a symbol before the amount without a space, after it with one", () => {
    assert.equal(writtenAmount("10.00", "USD", "symbol"), "$10");
    assert.equal(writtenAmount("15.00", "PLN", "symbol"), "15 zł");
    assert.equal(writtenAmount("15.50", "EUR", "symbol"), "15.50 €");
  });

  it("writes the code, or the number alone", () => {
    assert.equal(writtenAmount("15.00", "PLN", "code"), "15 PLN");
    assert.equal(writtenAmount("15.50", "PLN", "none"), "15.50");
  });

  it("writes the number as generated text does, whatever the style (#1787)", () => {
    assert.equal(writtenAmount("15.5", "USD", "symbol"), "$15.50");
    assert.equal(writtenAmount("15.5", "USD", "none"), "15.50");
  });

  it("writes the code for a currency with no symbol", () => {
    assert.equal(writtenAmount("15.00", "XYZ", "symbol"), "15 XYZ");
  });
});

describe("template tokens with a parameter (#2028)", () => {
  const values = { "{price}": (style: "symbol" | "code" | "none") => writtenAmount("15.00", "PLN", style), "{title}": "Mercury" };

  it("splits a token into its placeholder and parameter", () => {
    assert.deepEqual(splitTemplateToken("{price}"), { placeholder: "{price}", parameter: null });
    assert.deepEqual(splitTemplateToken("{price:code}"), { placeholder: "{price}", parameter: "code" });
    assert.deepEqual(splitTemplateToken("{price:}"), { placeholder: "{price}", parameter: "" });
  });

  it("finds tokens with and without a parameter, once each", () => {
    assert.deepEqual(templateTokens("{price} {price:code} {price} {a:b:c} {title:}"), ["{price}", "{price:code}", "{title:}"]);
  });

  it("writes an amount in the style asked for, the symbol when none is", () => {
    assert.equal(resolveTemplateToken("{price}", values), "15 zł");
    assert.equal(resolveTemplateToken("{price:symbol}", values), "15 zł");
    assert.equal(resolveTemplateToken("{price:code}", values), "15 PLN");
    assert.equal(resolveTemplateToken("{price:none}", values), "15");
    assert.equal(resolveTemplateToken("{price}", values, "code"), "15 PLN");
  });

  it("resolves nothing for an unknown name, a parameter on text, or one that is not a choice", () => {
    assert.equal(resolveTemplateToken("{title}", values), "Mercury");
    assert.equal(resolveTemplateToken("{title:code}", values), null);
    assert.equal(resolveTemplateToken("{price:cod}", values), null);
    assert.equal(resolveTemplateToken("{price:}", values), null);
    assert.equal(resolveTemplateToken("{toString}", values), null);
  });

  it("knows a token as a placeholder only with a parameter its placeholder takes", () => {
    const specs = [{ token: "{price}", amount: true }, { token: "{title}" }];
    assert.equal(isKnownTemplateToken("{price:none}", specs), true);
    assert.equal(isKnownTemplateToken("{price:Code}", specs), false);
    assert.equal(isKnownTemplateToken("{title}", specs), true);
    assert.equal(isKnownTemplateToken("{title:none}", specs), false);
    assert.equal(isKnownTemplateToken("{lot}", specs), false);
  });
});
