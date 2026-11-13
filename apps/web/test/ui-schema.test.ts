import { describe, expect, it } from "vitest";
import { localeFromCookie, translate } from "../src/lib/i18n.js";
import {
  parseUiSchema,
  validateFormInput,
  type FormResultSchema,
} from "../src/lib/ui-schema.js";

describe("i18n (task 4.6 — D12/D15)", () => {
  it("translates platform UI keys in both locales", () => {
    expect(translate("zh", "hub.title")).toBe("应用中心");
    expect(translate("en", "hub.title")).toBe("App Hub");
    expect(translate("zh", "task.continue")).toBe("继续修改");
  });

  it("locale resolves from cookie with zh default", () => {
    expect(localeFromCookie("en")).toBe("en");
    expect(localeFromCookie("zh")).toBe("zh");
    expect(localeFromCookie(undefined)).toBe("zh");
    expect(localeFromCookie("fr")).toBe("zh");
  });
});

const formSchema: FormResultSchema = {
  template: "form-result",
  fields: [
    { name: "theme", label: "主题", type: "text", required: true },
    { name: "style", label: "风格", type: "select", required: true, options: ["简约", "喜庆"] },
    { name: "count", label: "数量", type: "number" },
    { name: "notes", label: "备注", type: "textarea" },
  ],
};

describe("UI schema (task 4.4 — D24)", () => {
  it("parses valid form-result schemas and rejects malformed ones", () => {
    expect(parseUiSchema(formSchema).ok).toBe(true);
    expect(parseUiSchema({ template: "unknown" }).ok).toBe(false);
    expect(
      parseUiSchema({
        template: "form-result",
        fields: [{ name: "x", label: "X", type: "select" }],
      }).ok,
    ).toBe(false); // select without options
    expect(
      parseUiSchema({
        template: "document-flow",
        uploadField: { name: "brief", label: "需求", type: "text" },
        outlineStage: { label: "大纲" },
        progressStage: { label: "进度" },
        downloadStage: { label: "下载" },
      }).ok,
    ).toBe(true);
  });

  it("validates required fields, numbers and select options", () => {
    expect(validateFormInput(formSchema, { theme: "秋促", style: "简约" }).ok).toBe(true);
    const missing = validateFormInput(formSchema, { style: "简约" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors.some((e) => e.field === "theme")).toBe(true);
    }
    const badNumber = validateFormInput(formSchema, {
      theme: "t",
      style: "简约",
      count: "abc",
    });
    expect(badNumber.ok).toBe(false);
    const badOption = validateFormInput(formSchema, {
      theme: "t",
      style: "蒸汽波",
    });
    expect(badOption.ok).toBe(false);
    // Optional fields may be empty.
    expect(
      validateFormInput(formSchema, { theme: "t", style: "喜庆", notes: "" }).ok,
    ).toBe(true);
  });
});
