import { registerTemplate, renderApi } from "lwc";
const { t: api_text, h: api_element } = renderApi;
const $hoisted1 = api_element(
  "p",
  {
    key: 0,
  },
  [api_text("Root")],
  true
);
function tmpl($api, $cmp, $slotset, $ctx) {
  return [$hoisted1];
  /*LWC compiler vX.X.X*/
}
export default registerTemplate(tmpl);
tmpl.stylesheets = [];
