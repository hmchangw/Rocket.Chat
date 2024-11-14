import React from 'react';

import FileItem from './FileItem';
import VerticalBar from '../../../../../components/VerticalBar';

export default {
	title: 'room/ContextualBar/RoomFiles/FileItem',
	component: FileItem,
};

const fileData = {
	name: 'Lorem Ipsum Indolor Dolor',
	url: '#',
	uploadedAt: 'May 02, 2020 01:00 PM',
	user: {
		username: 'loremIpsum',
	},
};

export const Default = () => (
	<VerticalBar>
		<FileItem fileData={fileData} />
	</VerticalBar>
);
