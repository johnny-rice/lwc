import { registerTemplate, renderApi, sanitizeAttribute } from "lwc";
const { h: api_element } = renderApi;
const $hoisted1 = api_element(
  "svg",
  {
    classMap: {
      "slds-button__icon": true,
    },
    attrs: {
      viewBox: "0 0 5 5",
      "aria-hidden": "true",
    },
    key: 0,
    svg: true,
  },
  [
    api_element("use", {
      attrs: {
        "xlink:href": sanitizeAttribute(
          "use",
          "http://www.w3.org/2000/svg",
          "xlink:href",
          "/x"
        ),
      },
      key: 1,
      svg: true,
    }),
  ],
  true
);
function tmpl($api, $cmp, $slotset, $ctx) {
  return [$hoisted1];
  /*LWC compiler vX.X.X*/
}
export default registerTemplate(tmpl);
tmpl.stylesheets = [];
