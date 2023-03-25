import { addons } from '@storybook/addons';
import { FORCE_REMOUNT } from '@storybook/core-events';
import { type Preview, setup } from '@storybook/vue3';
import { initialize, mswDecorator } from 'msw-storybook-addon';
import locale from './locale';
import { commonHandlers, onUnhandledRequest } from './mocks';
import themes from './themes';
import '../src/style.scss';

// TODO: HMR が壊れているのを直す
import.meta.hot.invalidate();

const appInitialized = Symbol();

let moduleInitialized = false;
let unobserve = () => {};
let misskeyOS = null;

function loadTheme(applyTheme: typeof import('../src/scripts/theme')['applyTheme']) {
	unobserve();
	const theme = themes[document.documentElement.dataset.misskeyTheme];
	if (theme) {
		applyTheme(themes[document.documentElement.dataset.misskeyTheme]);
	}
	const observer = new MutationObserver((entries) => {
		for (const entry of entries) {
			if (entry.attributeName === 'data-misskey-theme') {
				const target = entry.target as HTMLElement;
				const theme = themes[target.dataset.misskeyTheme];
				if (theme) {
					applyTheme(themes[target.dataset.misskeyTheme]);
				} else {
					target.removeAttribute('style');
				}
			}
		}
	});
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-misskey-theme'],
	});
	unobserve = () => observer.disconnect();
}

initialize({
	onUnhandledRequest,
});
localStorage.setItem("locale", JSON.stringify(locale));
queueMicrotask(() => {
	Promise.all([
		import('../src/components'),
		import('../src/directives'),
		import('../src/widgets'),
		import('../src/scripts/theme'),
		import('../src/os'),
	]).then(([{ default: components }, { default: directives }, { default: widgets }, { applyTheme }, os]) => {
		setup((app) => {
			moduleInitialized = true;
			if (app[appInitialized]) {
				return;
			}
			app[appInitialized] = true;
			loadTheme(applyTheme);
			components(app);
			directives(app);
			widgets(app);
			misskeyOS = os;
		});
	});
});

const preview = {
	decorators: [
		(Story, context) => {
			const story = Story();
			if (!moduleInitialized) {
				const channel = addons.getChannel();
				(globalThis.requestIdleCallback || setTimeout)(() => {
					channel.emit(FORCE_REMOUNT, { storyId: context.id });
				});
			}
			return story;
		},
		mswDecorator,
		(Story, context) => {
			return {
				setup() {
					return {
						context,
						popups: misskeyOS.popups,
					};
				},
				template: '<div><component :is="popup.component" v-for="popup in popups" :key="popup.id" v-bind="popup.props" v-on="popup.events"/><story /></div>',
			};
		},
	],
	parameters: {
		msw: {
			handlers: commonHandlers,
		},
	},
} satisfies Preview;

export default preview;
