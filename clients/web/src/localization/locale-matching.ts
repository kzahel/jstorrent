/** Catalog equivalences after exact and RFC 4647 parent lookup.
 * Keep this small and shared in behavior with native desktop and Android:
 * an explicit Chinese script wins over the region. Unknown scripts and unknown
 * scriptless regions never imply a Chinese writing system. Extension values
 * (including Unicode region overrides) do not change the requested script.
 */
export function regionalCatalogLocale(tag: string): string | undefined {
  const core = tag.toLowerCase().split(/-[a-z0-9]-/)[0];
  if (core === "pt-latn-br") return "pt-BR";
  const chinese = /^zh(?:-([a-z]{4}))?(?:-([a-z]{2}|[0-9]{3}))?$/.exec(core ?? "");
  if (chinese === null) return undefined;
  const [, script, region] = chinese;
  if (script !== undefined) {
    if (script === "hans") return "zh-CN";
    if (script === "hant") return "zh-TW";
    return undefined;
  }
  if (region === "cn" || region === "sg") return "zh-CN";
  if (region === "tw" || region === "hk") return "zh-TW";
  return undefined;
}
