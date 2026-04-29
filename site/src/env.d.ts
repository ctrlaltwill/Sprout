/// <reference types="astro/client" />

export {};

type StarlightComponent = import("astro/runtime/server/index.js").AstroComponentFactory;

declare module "virtual:starlight/components/LanguageSelect" {
	const Component: StarlightComponent;
	export default Component;
}

declare module "virtual:starlight/components/Search" {
	const Component: StarlightComponent;
	export default Component;
}

declare module "virtual:starlight/components/SiteTitle" {
	const Component: StarlightComponent;
	export default Component;
}

declare module "virtual:starlight/components/SocialIcons" {
	const Component: StarlightComponent;
	export default Component;
}

declare module "virtual:starlight/components/ThemeSelect" {
	const Component: StarlightComponent;
	export default Component;
}

declare global {
	interface Window {
		StarlightThemeProvider?: {
			updatePickers(theme?: "auto" | "dark" | "light"): void;
		};
	}
}