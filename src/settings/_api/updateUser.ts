import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import sharp from 'sharp';
import path from 'path';

// Set the request limit per minute. Set to false to use the default config value config.rateLimiting
export const rateLimit: number | false = 20;

// HTTP method for this API. If not set, inferred from name (get* = GET, delete* = DELETE, else POST)
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: []
};

export interface ApiParams {
  data: {
    name?: string;
    theme?: 'light' | 'dark';
    language?: string;
    avatar?: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {

  const { avatar, name, theme, language } = data;

  if (avatar) {
    console.log(avatar)
    const matches = avatar.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, "base64");

      // save as WebP under user's ID
      const fileName = `${user.id}.webp`;
      const filePath = path.join(process.cwd(), "uploads", fileName);

      try {
        await sharp(buffer)
          .webp({ quality: 80 }) // adjust quality if you want
          .toFile(filePath);

        console.log(`✅ Avatar saved for ${user.name} at ${filePath}`);
      } catch (err) {
        console.error("Error saving avatar:", err);
        return { status: "error" };
      }
    } else { console.log("failed to upload new avatar") }
  }

  let newData = {};

  if (avatar) newData = { ...newData, avatar: `${user.id}` }
  if (name) newData = { ...newData, name }
  if (theme) newData = { ...newData, theme }
  if (language) newData = { ...newData, language }

  //? here we can assume the avatar was uploaded successfully if avatar !=  null

  console.log(user)
  if (!user.token) return { status:'error' }

  await functions.prisma.user.update({
    where: { id: user.id },
    data: newData
  })

  await functions.saveSession(user.token, {...user, ...newData});

  return { status: 'success', result: {} }
};