/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-duplicates */
import { StoryObj } from '@storybook/vue3';
import { userDetailed } from '../../../.storybook/fakes';
import MkAcct from './MkAcct.vue';
export const Default = {
	render(args) {
		return {
			components: {
				MkAcct,
			},
			setup() {
				return {
					args,
				};
			},
			computed: {
				props() {
					return {
						...args,
					};
				},
			},
			template: '<MkAcct v-bind="props" />',
		};
	},
	args: {
		user: userDetailed,
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkAcct>;
export const Detail = {
	...Default,
	args: {
		...Default.args,
		detail: true,
	},
} satisfies StoryObj<typeof MkAcct>;
