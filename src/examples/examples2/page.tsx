import { apiRequest } from "src/_sockets/apiRequest";

export default function Page() {

  const test = async () => {
    const result = await apiRequest({
      name: 'jow',
      data: { email: 'john' }
    });
    console.log(result);
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-green-200 gap-10 flex-col text-black">
      <h1>Page</h1>
      <button onClick={async () => {
        const skibidyResult = await apiRequest({
          name: 'skibidi',
          data: { name: 'test123' }
        });
        console.log(skibidyResult);
      }}>Test</button>
    </div>
  );
}