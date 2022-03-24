import { registerTemplate, renderApi } from "lwc";
const { t: api_text, h: api_element, s: api_slot } = renderApi;
const $hoisted1 = api_element(
  "p",
  {
    key: 1,
  },
  [api_text("Sibling")],
  true
);
const $hoisted2 = api_element(
  "p",
  {
    key: 3,
  },
  [api_text("Default slot content")],
  true
);
const stc0 = {
  key: 0,
};
const stc1 = {
  key: 2,
};
function tmpl($api, $cmp, $slotset, $ctx) {
  return [
    api_element("section", stc0, [
      $hoisted1,
      api_slot("", stc1, [$hoisted2], $slotset),
    ]),
  ];
  /*LWC compiler vX.X.X*/
}
export default registerTemplate(tmpl);
tmpl.slots = [""];
tmpl.stylesheets = [];
