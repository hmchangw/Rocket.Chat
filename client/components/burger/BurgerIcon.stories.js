import React from 'react';

import BurgerIcon from './BurgerIcon';
import { centeredDecorator } from '../../../.storybook/decorators';
import { useAutoToggle } from '../../../.storybook/hooks';

export default {
	title: 'components/burger/BurgerIcon',
	component: BurgerIcon,
	decorators: [centeredDecorator],
};

export const Normal = () => <BurgerIcon />;

export const Open = () => <BurgerIcon open />;

export const Transitioning = () => <BurgerIcon open={useAutoToggle()} />;
