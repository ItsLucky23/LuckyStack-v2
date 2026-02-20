export default function Overview({ 
  params,
  searchParams
}: { 
  params: { 
    id: string 
  },
  searchParams: Record<string, string | string[] | undefined>
}) {
  console.log(searchParams)
  return (
    <div className="text-black">
      <h1>Overview {params.id}</h1>
    </div>
  );    
}