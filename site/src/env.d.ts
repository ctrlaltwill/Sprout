/// <reference types="astro/client" />

export {};

declare module "virtual:starlight/components/LanguageSelect" {
	const Component: any;
	export default Component;
}

declare module "virtual:starlight/components/Search" {
	const Component: any;
	export default Component;
}

declare module "virtual:starlight/components/SiteTitle" {
	const Component: any;
	export default Component;
}

declare module "virtual:starlight/components/SocialIcons" {
	const Component: any;
	export default Component;
}

declare module "virtual:starlight/components/ThemeSelect" {
	const Component: any;
	export default Component;
}

declare global {
	interface Window {
		StarlightThemeProvider?: {
			updatePickers(theme?: "auto" | "dark" | "light"): void;
		};
	}
}