/*
 * SPDX-FileCopyrightText: syuilo and other misskey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Directive } from 'vue';
import { makeHotkey } from '../scripts/hotkey';

export default {
	mounted(el, binding) {
		el._hotkey_global = binding.modifiers.global === true;

		el._keyHandler = makeHotkey(binding.value);

		if (el._hotkey_global) {
			document.addEventListener('keydown', el._keyHandler);
		} else {
			el.addEventListener('keydown', el._keyHandler);
		}
	},

	unmounted(el) {
		if (el._hotkey_global) {
			document.removeEventListener('keydown', el._keyHandler);
		} else {
			el.removeEventListener('keydown', el._keyHandler);
		}
	},
} as Directive;
