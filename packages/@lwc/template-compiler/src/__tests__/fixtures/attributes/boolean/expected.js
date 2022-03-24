import { registerTemplate, renderApi } from "lwc";
const { t: api_text, h: api_element } = renderApi;
const $hoisted1 = api_element(
  "p",
  {
    attrs: {
      hidden: "",
    },
    key: 0,
  },
  [api_text("x")],
  true
);
function tmpl($api, $cmp, $slotset, $ctx) {
  return [
    $hoisted1,
    api_element("input", {
      attrs: {
        readonly: $cmp.getReadOnly ? "" : null,
        disabled: "",
        title: "foo",
      },
      key: 1,
    }),
  ];
  /*LWC compiler vX.X.X*/
}
export default registerTemplate(tmpl);
tmpl.stylesheets = [];
