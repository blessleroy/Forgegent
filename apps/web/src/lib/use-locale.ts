"use client";

import { useEffect, useState } from "react";
import { localeFromCookie, translate, type Locale, type MessageKey } from "./i18n";

export function useLocale() {
  const [locale, setLocale] = useState<Locale>("zh");
  useEffect(() => {
    setLocale(localeFromCookie(document.cookie.split("forgegent_locale=")[1]?.split(";")[0]));
  }, []);
  const t = (key: MessageKey) => translate(locale, key);
  return { locale, t, setLocale };
}
