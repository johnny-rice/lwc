import _implicitStylesheets from "./iterator.css";
import _implicitScopedStylesheets from "./iterator.scoped.css?scoped=true";
import { freezeTemplate, parseFragment, registerTemplate } from "lwc";
const $fragment1 = parseFragment`<div${"a0:data-islast"}${"a0:data-isfirst"}${3}><span${3}>${"t2"}</span>${"t3"}</div>`;
const stc0 = {
  key: 0,
};
function tmpl($api, $cmp, $slotset, $ctx) {
  const {
    k: api_key,
    d: api_dynamic_text,
    sp: api_static_part,
    st: api_static_fragment,
    i: api_iterator,
    h: api_element,
  } = $api;
  return [
    api_element(
      "section",
      stc0,
      api_iterator($cmp.items, function (xValue, xIndex, xFirst, xLast) {
        const x = {
          value: xValue,
          index: xIndex,
          first: xFirst,
          last: xLast,
        };
        return api_static_fragment($fragment1, api_key(2, x.value.id), [
          api_static_part(
            0,
            {
              attrs: {
                "data-islast": x.last,
                "data-isfirst": x.first,
              },
            },
            null
          ),
          api_static_part(2, null, "Row: " + api_dynamic_text(x.index)),
          api_static_part(3, null, ". Value: " + api_dynamic_text(x.value)),
        ]);
      })
    ),
  ];
  /*LWC compiler vX.X.X*/
}
export default registerTemplate(tmpl);
tmpl.stylesheets = [];
tmpl.stylesheetToken = "lwc-34811vn79s2";
tmpl.legacyStylesheetToken = "x-iterator_iterator";
if (_implicitStylesheets) {
  tmpl.stylesheets.push.apply(tmpl.stylesheets, _implicitStylesheets);
}
if (_implicitScopedStylesheets) {
  tmpl.stylesheets.push.apply(tmpl.stylesheets, _implicitScopedStylesheets);
}
freezeTemplate(tmpl);
