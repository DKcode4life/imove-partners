import CRMSidebar from './CRMSidebar';

interface Props {
  children: React.ReactNode;
}

export default function CRMLayout({ children }: Props) {
  return (
    <div className="flex min-h-screen bg-slate-100">
      <CRMSidebar />
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
