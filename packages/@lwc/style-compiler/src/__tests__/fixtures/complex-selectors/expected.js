const stylesheet = {
  f: function (hostSelector, shadowSelector, nativeShadow) {
    return ["h1", shadowSelector, " > a", shadowSelector, " {}h1", shadowSelector, " + a", shadowSelector, " {}div.active", shadowSelector, " > p", shadowSelector, " {}"].join('');
  }
}
export default [stylesheet];