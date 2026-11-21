"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SpecificationLanguageSelect } from "../specification-language-select";

/** The printable page's **Language** (#2605): the choice is the page's `?language=`, so the page is
 *  read again in it and a reload or a saved address keeps it. The offer's own language is the bare
 *  address. */
export function SpecificationPageLanguage({
  language,
  offerLanguage,
  languages,
}: {
  language: string | null;
  offerLanguage: string | null;
  languages: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  return (
    <SpecificationLanguageSelect
      id="specification-language"
      value={language}
      offerLanguage={offerLanguage}
      languages={languages}
      disabled={isPending}
      onChange={(next) =>
        startTransition(() =>
          router.replace(
            next === offerLanguage ? pathname : `${pathname}?language=${encodeURIComponent(next)}`
          )
        )
      }
    />
  );
}
