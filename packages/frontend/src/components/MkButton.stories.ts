/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import { Meta } from '@storybook/vue3';
const meta = {
	title: 'components/MkButton',
	component: MkButton,
} satisfies Meta<typeof MkButton>;
export default meta;
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
/* eslint-disable import/no-duplicates */
import { StoryObj } from '@storybook/vue3';
import MkButton from './MkButton.vue';
export const Default = {
	render(args) {
		return {
			components: {
				MkButton,
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
			template: '<MkButton v-bind="props">Text</MkButton>',
		};
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkButton>;
