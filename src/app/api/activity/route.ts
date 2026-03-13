import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
    try {
        const ab_users = await prisma.ab_users.findMany();
        const activities = await prisma.activity.findMany({
            where: {
                userId: ab_users[0].id,
            },
        });
        return NextResponse.json(activities);
    } catch (error) {
        console.error('Error fetching activities:', error);
        return NextResponse.error();
    }
}