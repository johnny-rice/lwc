import _implicitStylesheets from "./assignment-inside-arrow.css";
import _implicitScopedStylesheets from "./assignment-inside-arrow.scoped.css?scoped=true";
import { freezeTemplate, parseFragment, registerTemplate } from "lwc";
const $fragment1 = parseFragment`<section${3}><button${3}></button></section>`;
function tmpl($api, $cmp, $slotset, $ctx) {
  const { b: api_bind, sp: api_static_part, st: api_static_fragment } = $api;
  const { _m0 } = $ctx;
  return [
    api_static_fragment($fragment1, 1, [
      api_static_part(
        1,
        {
          on:
            _m0 ||
            ($ctx._m0 = {
              click: api_bind(() => ($cmp.myField = "foo")),
            }),
        },
        null
      ),
    ]),
  ];
  /*LWC compiler vX.X.X*/
}
export default registerTemplate(tmpl);
tmpl.stylesheets = [];
tmpl.stylesheetToken = "lwc-7uuiq9sbjjh";
tmpl.legacyStylesheetToken =
  "x-assignment-inside-arrow_assignment-inside-arrow";
if (_implicitStylesheets) {
  tmpl.stylesheets.push.apply(tmpl.stylesheets, _implicitStylesheets);
}
if (_implicitScopedStylesheets) {
  tmpl.stylesheets.push.apply(tmpl.stylesheets, _implicitScopedStylesheets);
}
freezeTemplate(tmpl);
