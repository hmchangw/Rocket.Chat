import React, { memo } from 'react';

import VerticalBarAction from './VerticalBarAction';
import { useTranslation } from '../../contexts/TranslationContext';

function VerticalBarClose(props) {
	const t = useTranslation();
	return <VerticalBarAction {...props} title={t('Close')} name='cross' />;
}

export default memo(VerticalBarClose);
