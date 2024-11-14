import { Modal } from '@rocket.chat/fuselage';
import React, { useState } from 'react';

import CopyStep from './CopyStep';
import PasteStep from './PasteStep';
import { useTranslation } from '../../../contexts/TranslationContext';

const Steps = {
	COPY: 'copy',
	PASTE: 'paste',
};

function ManualWorkspaceRegistrationModal({ onClose, props }) {
	const t = useTranslation();

	const [step, setStep] = useState(Steps.COPY);

	const handleNextButtonClick = () => {
		setStep(Steps.PASTE);
	};

	const handleBackButtonClick = () => {
		setStep(Steps.COPY);
	};

	return (
		<Modal {...props}>
			<Modal.Header>
				<Modal.Title>{t('Cloud_Register_manually')}</Modal.Title>
				<Modal.Close onClick={onClose} />
			</Modal.Header>
			{(step === Steps.COPY && <CopyStep onNextButtonClick={handleNextButtonClick} />) ||
				(step === Steps.PASTE && (
					<PasteStep onBackButtonClick={handleBackButtonClick} onFinish={onClose} />
				))}
		</Modal>
	);
}

export default ManualWorkspaceRegistrationModal;
