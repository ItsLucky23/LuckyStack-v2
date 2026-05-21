import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import sharp from 'sharp';
import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { getUploadsDir, processUpload } from '@luckystack/core';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: []
};

export interface ApiParams {
  data: {
    name?: string;
    theme?: SessionLayout['theme'];
    language?: SessionLayout['language'];
    avatar?: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {

  const { avatar, name, theme, language } = data;

  if (avatar) {
    const matches = /^data:(.+);base64,(.+)$/.exec(avatar);
    if (!matches) {
      return { status: "error", errorCode: 'avatar.invalidFormat' };
    }
    const contentType = matches[1];
    const buffer = Buffer.from(matches[2], "base64");
    const fileName = `${user.id}.webp`;
    const uploadsDir = getUploadsDir();
    const filePath = path.join(uploadsDir, fileName);

    //? `processUpload` handles the onUploadStart / onUploadComplete hooks
    //? around our sharp encode-and-save callback. The framework owns the
    //? hook contract; we just provide the encoder.
    const result = await processUpload({
      userId: user.id,
      contentType,
      buffer,
      uploadKind: 'avatar',
      fileName,
      encodeAndSave: async (raw) => {
        await mkdir(uploadsDir, { recursive: true });
        await sharp(raw).webp({ quality: 80 }).toFile(filePath);
        const savedStat = await stat(filePath).catch(() => null);
        return savedStat?.size ?? raw.byteLength;
      },
    });

    if (result.status === 'rejected') {
      return { status: 'error', errorCode: result.errorCode };
    }
    if (result.status === 'error') {
      return { status: 'error', errorCode: 'avatar.uploadFailed' };
    }
  }

  let newData: Partial<Pick<SessionLayout, 'avatar' | 'name' | 'theme' | 'language'>> = {};

  if (avatar) newData = { ...newData, avatar: user.id }
  if (name) newData = { ...newData, name }
  if (theme) newData = { ...newData, theme }
  if (language) newData = { ...newData, language }

  if (!user.token) return { status: 'error', errorCode: 'session.invalid' }

  await functions.db.prisma.user.update({
    where: { id: user.id },
    data: newData
  })

  await functions.session.saveSession(user.token, { ...user, ...newData });

  return { status: 'success', result: {} }
};
