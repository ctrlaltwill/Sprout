const prefixer = require("postcss-prefix-selector");

module.exports = {
  plugins: [
    prefixer({
      prefix: ".learnkit",
      transform(prefix, selector) {
        if (!selector) return selector;
        if (selector.startsWith("@")) return selector;

        // Leave global roots alone
        if (selector.startsWith(":root") || selector.startsWith("html") || selector.startsWith("body")) {
          return selector;
        }

        // Already scoped
        if (selector.includes(".learnkit")) return selector;

        // Scope by ancestor
        return `${prefix} ${selector}`;
      },
    }),
  ],
};
