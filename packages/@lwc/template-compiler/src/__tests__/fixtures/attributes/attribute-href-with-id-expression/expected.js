import _implicitStylesheets from "./attribute-href-with-id-expression.css";
import _implicitScopedStylesheets from "./attribute-href-with-id-expression.scoped.css?scoped=true";
import { freezeTemplate, parseFragment, registerTemplate } from "lwc";
const $fragment1 = parseFragment`<a${"a0:href"}${3}>KIX</a>`;
const $fragment2 = parseFragment`<h1${"a0:id"}${3}>Time to travel!</h1>`;
const stc0 = {
  key: 2,
};
function tmpl($api, $cmp, $slotset, $ctx) {
  const {
    fid: api_scoped_frag_id,
    sp: api_static_part,
    st: api_static_fragment,
    h: api_element,
    gid: api_scoped_id,
  } = $api;
  return [
    api_static_fragment($fragment1, 1, [
      api_static_part(
        0,
        {
          attrs: {
            href: api_scoped_frag_id($cmp.narita),
          },
        },
        null
      ),
    ]),
    api_element("map", stc0, [
      api_element("area", {
        attrs: {
          href: api_scoped_frag_id("#haneda"),
        },
        key: 3,
      }),
      api_element("area", {
        attrs: {
          href: api_scoped_frag_id("#chubu"),
        },
        key: 4,
      }),
    ]),
    api_static_fragment($fragment2, 6, [
      api_static_part(
        0,
        {
          attrs: {
            id: api_scoped_id("#narita"),
          },
        },
        null
      ),
    ]),
  ];
  /*LWC compiler vX.X.X*/
}
export default registerTemplate(tmpl);
tmpl.stylesheets = [];
tmpl.stylesheetToken = "lwc-4s0jmj9uli4";
tmpl.legacyStylesheetToken =
  "x-attribute-href-with-id-expression_attribute-href-with-id-expression";
if (_implicitStylesheets) {
  tmpl.stylesheets.push.apply(tmpl.stylesheets, _implicitStylesheets);
}
if (_implicitScopedStylesheets) {
  tmpl.stylesheets.push.apply(tmpl.stylesheets, _implicitScopedStylesheets);
}
freezeTemplate(tmpl);
