import { ReactNode, useState } from 'react';

import { menuHandler } from 'src/_functions/menuHandler';

interface ConfirmMenuProps {
  title: string;
  content?: string | ReactNode;
  // confirm: () => void;
  input?: string;
  resolve: (val: boolean) => void;
}

export const ConfirmMenu = ({ title, content, input, resolve }: ConfirmMenuProps) => {
// export const ConfirmMenu = ({ title, content, confirm, input, resolve }: ConfirmMenuProps) => {
  const [inputValue, setInputValue] = useState('');

  const handleConfirm = () => {
    if (input && input !== inputValue) return;
    // confirm();
    resolve(true);
    menuHandler.close();
  };

  const handleCancel = () => {
    resolve(false);
    menuHandler.close();
  };

  const inputRequiredAndInvalid = input && input !== inputValue ? true : false;

  return (
    <div className="p-6 flex flex-col gap-4 bg-white w-full max-w-md">
      <h2 className="text-xl font-bold">{title}</h2>

      {typeof content === 'string' ? (
        <p className="text-gray-700">{content}</p>
      ) : (
        content
      )}

      {input && (
        <div className="flex flex-col gap-1">
          <label className="text-sm text-gray-600">
            Type <span className="font-mono bg-gray-100 px-1">{input}</span> to confirm:
          </label>
          <input
            type="text"
            className="border rounded px-2 py-1 focus:border outline-none focus:ring-0"
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); }}
          />
        </div>
      )}

      <div className="flex gap-4 justify-end">
        <button
          onClick={handleCancel}
          className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 text-sm font-semibold"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={inputRequiredAndInvalid}
          className={`px-4 py-2 rounded text-sm text-white transition font-semibold
            ${inputRequiredAndInvalid
              ? 'bg-blue-300 cursor-not-allowed'
              : 'bg-blue-500 hover:bg-blue-700 cursor-pointer'
            }`}
        >
          Confirm
        </button>
      </div>
    </div>
  );
};

// export const confirmDialog = async (props: Omit<ConfirmMenuProps, 'resolve'>): Promise<boolean> => {
//   return await menuHandler.open(
//     <ConfirmMenu {...props} resolve={(a) => {console.log(a)}} />,
//     { dimBackground: true, background: 'bg-white', size: 'sm' }
//   );
// };
export const confirmDialog = (props: Omit<ConfirmMenuProps, 'resolve'>): Promise<boolean> => {
  return new Promise((resolve) => {
    menuHandler.open(
      <ConfirmMenu {...props} resolve={resolve} />,
      { dimBackground: true, background: 'bg-white', size: 'sm' }
    );
  });
};
