const memoized = Symbol();
export default function ($api, $cmp, $slotset) {
  const m = $cmp[memoized] || ($cmp[memoized] = {});
  return [$api.h(
    "section",
    {},
    [$api.h(
      "p",
      {
        attrs: {
          "data-foo": "1",
          "data-bar-baz": "xyz"
        }
      },
      []
    )]
  )];
}
export const templateUsedIds = [];
